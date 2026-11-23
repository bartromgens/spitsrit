import secrets
from datetime import datetime, time, timedelta
from typing import cast
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.db.models import QuerySet
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, HttpResponseRedirect
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

from api import google, ns, places
from api.models import Commute, GoogleAccount
from api.serializers import (
    ClientConfigSerializer,
    CommuteSerializer,
    CommuteTripsSerializer,
    LoginSerializer,
    OvFietsSerializer,
    RegisterSerializer,
    StationSerializer,
    StationToiletsSerializer,
    TripSerializer,
    UserSerializer,
)


def ns_error_response(error: ns.NsError) -> Response:
    if isinstance(error, ns.NsNotConfigured):
        return Response(
            {"detail": "Train data is not configured on this server."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return Response({"detail": "The NS API is not answering."}, status=status.HTTP_502_BAD_GATEWAY)


DUTCH_TIME_ZONE = ZoneInfo("Europe/Amsterdam")
USUAL_TIME_LEAD = timedelta(minutes=15)
WAIT_ADVICE_HORIZON = timedelta(minutes=60)


def usual_planning_time(usual: time | None, now: datetime) -> datetime | None:
    """15 minutes before today's usual departure (Dutch local time), if that is still ahead."""
    if usual is None:
        return None
    local_now = now.astimezone(DUTCH_TIME_ZONE)
    usual_at = datetime.combine(local_now.date(), usual.replace(tzinfo=None), DUTCH_TIME_ZONE)
    return usual_at - USUAL_TIME_LEAD if usual_at > now else None


def requested_planning_time(requested: time, now: datetime, around: bool) -> tuple[datetime, bool]:
    """When to plan from for a Dutch local time of day, and whether that is tomorrow.

    A time before now (to the minute) means tomorrow. With `around`, plans from 15 minutes
    before it, as the commute board does.
    """
    wall_clock = requested.replace(tzinfo=None)
    local_now = now.astimezone(DUTCH_TIME_ZONE)
    at = datetime.combine(local_now.date(), wall_clock, DUTCH_TIME_ZONE)
    tomorrow = at < local_now.replace(second=0, microsecond=0)
    if tomorrow:
        # Add the day to the local date, so a daylight-saving change keeps the wall clock.
        at = datetime.combine(local_now.date() + timedelta(days=1), wall_clock, DUTCH_TIME_ZONE)
    return (at - USUAL_TIME_LEAD if around else at), tomorrow


def trips_response(
    origin_code: str,
    destination_code: str,
    max_duration_minutes: int | None = None,
    max_transfers: int | None = None,
    usual_time: time | None = None,
    requested_time: time | None = None,
    around: bool = False,
    arrive: bool = False,
) -> Response:
    now = timezone.now()
    tomorrow = False
    if requested_time is not None:
        around = around and not arrive
        planned_from, tomorrow = requested_planning_time(requested_time, now, around)
        usual_from = planned_from if around else None
    else:
        usual_from = usual_planning_time(usual_time, now)
        planned_from = usual_from or now
    try:
        trips = ns.fetch_trips(
            origin_code, destination_code, planned_from, max_duration_minutes, max_transfers, arrive
        )
    except ns.NsError as error:
        return ns_error_response(error)
    trips = [
        t
        for t in trips
        if (max_duration_minutes is None or t.duration_minutes <= max_duration_minutes)
        and (max_transfers is None or t.transfers <= max_transfers)
    ]
    advice = ns.advise(trips, now, arrive)
    # The advice counts from now, so it only makes sense for a plan that starts soon. When
    # planning by arrival, that is the trip itself, as the arrival time can be far later.
    wait_minutes = advice.wait_minutes
    if wait_minutes is not None:
        starts_in = timedelta(minutes=wait_minutes) if arrive else planned_from - now
        if starts_in > WAIT_ADVICE_HORIZON:
            wait_minutes = None
    return Response(
        {
            "fetched_at": now,
            "planned_from": planned_from,
            "planned_from_usual_time": usual_from is not None,
            "planned_tomorrow": tomorrow,
            "trips": TripSerializer(trips, many=True).data,
            "recommended_uid": advice.recommended_uid,
            "wait_minutes": wait_minutes,
        }
    )


class CommuteViewSet(viewsets.ModelViewSet[Commute]):
    serializer_class = CommuteSerializer

    def get_queryset(self) -> QuerySet[Commute]:
        return Commute.objects.filter(user=cast(User, self.request.user))

    def perform_create(self, serializer: BaseSerializer[Commute]) -> None:
        serializer.save(user=self.request.user)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "now",
                bool,
                description="Plan from now, ignoring the commute's usual departure time",
            )
        ],
        responses={200: CommuteTripsSerializer, 502: None, 503: None},
    )
    @action(detail=True, methods=["get"])
    def trips(self, request: Request, pk: str | None = None) -> Response:
        """Upcoming trips for this commute within its saved filters, and which one to take.

        Plans from 15 minutes before the usual departure time while that is still ahead today.
        """
        commute = self.get_object()
        from_now = request.query_params.get("now", "").lower() in ("1", "true")
        return trips_response(
            commute.origin_code,
            commute.destination_code,
            commute.max_duration_minutes,
            commute.max_transfers,
            None if from_now else commute.usual_departure_time,
        )


@extend_schema(
    parameters=[OpenApiParameter("q", str, description="Part of a station name or its code")],
    responses={200: StationSerializer(many=True), 502: None, 503: None},
)
@api_view(["GET"])
@permission_classes([AllowAny])
def stations(request: Request) -> Response:
    """Search NS stations by name or code, for the commute form."""
    try:
        found = ns.search_stations(request.query_params.get("q", ""))
    except ns.NsError as error:
        return ns_error_response(error)
    return Response(StationSerializer(found, many=True).data)


@extend_schema(responses={200: OvFietsSerializer, 502: None, 503: None})
@api_view(["GET"])
@permission_classes([AllowAny])
def ov_fiets(request: Request, code: str) -> Response:
    """OV-fiets bikes available now at a station, per rental point and in total."""
    try:
        found = places.fetch_ov_fiets(code)
    except ns.NsError as error:
        return ns_error_response(error)
    return Response(OvFietsSerializer(found).data)


@extend_schema(responses={200: StationToiletsSerializer, 502: None, 503: None})
@api_view(["GET"])
@permission_classes([AllowAny])
def station_toilets(request: Request, code: str) -> Response:
    """The public toilets at a station, and whether each is open now."""
    try:
        found = places.fetch_toilets(code)
    except ns.NsError as error:
        return ns_error_response(error)
    return Response(StationToiletsSerializer(found).data)


@extend_schema(
    parameters=[
        OpenApiParameter("from", str, required=True, description="Origin station code"),
        OpenApiParameter("to", str, required=True, description="Destination station code"),
        OpenApiParameter(
            "time",
            str,
            description="Departure time as HH:MM, Dutch local time; earlier than now is tomorrow",
        ),
        OpenApiParameter(
            "arrive", bool, description="Treat `time` as the arrival time; needs `time`"
        ),
        OpenApiParameter(
            "around", bool, description="Plan from 15 minutes before `time`, as the commute board"
        ),
    ],
    responses={200: CommuteTripsSerializer, 400: None, 502: None, 503: None},
)
@api_view(["GET"])
@permission_classes([AllowAny])
def plan_trip(request: Request) -> Response:
    """Plan upcoming trips between two stations, without saving a commute."""
    origin = request.query_params.get("from", "").strip()
    destination = request.query_params.get("to", "").strip()
    if not origin or not destination:
        return Response(
            {"detail": "Both 'from' and 'to' are required."}, status=status.HTTP_400_BAD_REQUEST
        )
    if origin == destination:
        return Response(
            {"detail": "Origin and destination must differ."}, status=status.HTTP_400_BAD_REQUEST
        )
    requested_time: time | None = None
    raw_time = request.query_params.get("time", "").strip()
    if raw_time:
        try:
            requested_time = datetime.strptime(raw_time, "%H:%M").time()
        except ValueError:
            return Response({"detail": "'time' must be HH:MM."}, status=status.HTTP_400_BAD_REQUEST)
    arrive = request.query_params.get("arrive", "").lower() in ("1", "true")
    if arrive and requested_time is None:
        return Response(
            {"detail": "Arriving by needs a 'time'."}, status=status.HTTP_400_BAD_REQUEST
        )
    around = request.query_params.get("around", "").lower() in ("1", "true")
    return trips_response(
        origin, destination, requested_time=requested_time, around=around, arrive=arrive
    )


@extend_schema(responses=ClientConfigSerializer)
@api_view(["GET"])
@permission_classes([AllowAny])
def client_config(request: Request) -> Response:
    """Runtime config for the frontend, so one image serves every environment."""
    return Response(
        {
            "sentry_dsn": settings.SENTRY_DSN,
            "environment": settings.SENTRY_ENVIRONMENT,
            "release": settings.GIT_SHA,
            "google_login": google.is_configured(),
        }
    )


@extend_schema(responses={200: UserSerializer, 204: None})
@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def me(request: Request) -> Response:
    """The logged-in user, or 204 when logged out. Also sets the CSRF cookie."""
    if not request.user.is_authenticated:
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(UserSerializer(request.user).data)


@extend_schema(request=LoginSerializer, responses={200: UserSerializer, 400: None})
@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request: Request) -> Response:
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    identifier = serializer.validated_data["email"].strip()
    # Accounts made before email login may have a username that is not an email address.
    account = (
        User.objects.filter(username=identifier).first()
        or User.objects.filter(username__iexact=identifier).order_by("id").first()
        or User.objects.filter(email__iexact=identifier).order_by("id").first()
    )
    user = authenticate(
        request._request,
        username=account.username if account else identifier,
        password=serializer.validated_data["password"],
    )
    if user is None:
        return Response(
            {"detail": "Invalid email or password."}, status=status.HTTP_400_BAD_REQUEST
        )
    login(request._request, user)
    return Response(UserSerializer(user).data)


@extend_schema(request=RegisterSerializer, responses={201: UserSerializer, 400: None})
@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request: Request) -> Response:
    """Create an account with an email address and password, and log in."""
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = serializer.validated_data["email"]
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=email, email=email, password=serializer.validated_data["password"]
            )
    except IntegrityError:
        # A concurrent registration with the same email won the race.
        return Response(
            {"email": ["An account with this email address already exists."]},
            status=status.HTTP_400_BAD_REQUEST,
        )
    login(request._request, user, backend="django.contrib.auth.backends.ModelBackend")
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


GOOGLE_STATE_KEY = "google_oauth_state"
LOGIN_ERROR_URL = "/login?error=google"


def google_redirect_uri(request: HttpRequest) -> str:
    return request.build_absolute_uri(reverse("auth-google-callback"))


def user_for_google(profile: google.GoogleProfile) -> User:
    """The user for a Google account, created on the first login.

    Accounts are matched on Google's stable subject id and never on email, so a Google
    login cannot take over an existing password account.
    """
    linked = GoogleAccount.objects.select_related("user").filter(sub=profile.sub).first()
    if linked:
        return linked.user
    with transaction.atomic():
        username = profile.email
        if User.objects.filter(username=username).exists():
            username = f"{profile.email}#{profile.sub}"
        user = User.objects.create_user(
            username=username[:150], email=profile.email, first_name=profile.name[:150]
        )
        user.set_unusable_password()
        user.save(update_fields=["password"])
        GoogleAccount.objects.create(user=user, sub=profile.sub)
    return user


@extend_schema(request=None, responses={302: None})
@api_view(["GET"])
@permission_classes([AllowAny])
def google_start(request: Request) -> HttpResponse:
    """Send the browser to Google to sign in."""
    if not google.is_configured():
        return HttpResponseRedirect(LOGIN_ERROR_URL)
    state = secrets.token_urlsafe(32)
    request._request.session[GOOGLE_STATE_KEY] = state
    return HttpResponseRedirect(
        google.authorization_url(google_redirect_uri(request._request), state)
    )


@extend_schema(
    parameters=[OpenApiParameter("code", str), OpenApiParameter("state", str)],
    request=None,
    responses={302: None},
)
@api_view(["GET"])
@permission_classes([AllowAny])
def google_callback(request: Request) -> HttpResponse:
    """Finish the Google sign-in, creating the account on first login."""
    expected = request._request.session.pop(GOOGLE_STATE_KEY, None)
    state = request.query_params.get("state", "")
    code = request.query_params.get("code", "")
    if (
        not google.is_configured()
        or not expected
        or not secrets.compare_digest(str(expected), state)
        or not code
    ):
        return HttpResponseRedirect(LOGIN_ERROR_URL)
    try:
        profile = google.fetch_profile(code, google_redirect_uri(request._request))
    except google.GoogleError:
        return HttpResponseRedirect(LOGIN_ERROR_URL)
    login(
        request._request,
        user_for_google(profile),
        backend="django.contrib.auth.backends.ModelBackend",
    )
    return HttpResponseRedirect("/commutes")


@extend_schema(request=None, responses={204: None})
@api_view(["POST"])
def logout_view(request: Request) -> Response:
    logout(request._request)
    return Response(status=status.HTTP_204_NO_CONTENT)


def spa_index(request: HttpRequest) -> FileResponse:
    """Serve the Angular index.html for client-side routes."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise Http404("Frontend build not found.")
    return FileResponse(index.open("rb"), content_type="text/html")
