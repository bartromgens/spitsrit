import secrets
from typing import cast

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.db import transaction
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

from api import google, ns
from api.models import Commute, GoogleAccount
from api.serializers import (
    ClientConfigSerializer,
    CommuteSerializer,
    CommuteTripsSerializer,
    LoginSerializer,
    StationSerializer,
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


def trips_response(
    origin_code: str,
    destination_code: str,
    max_duration_minutes: int | None = None,
    max_transfers: int | None = None,
) -> Response:
    now = timezone.now()
    try:
        trips = ns.fetch_trips(origin_code, destination_code, now)
    except ns.NsError as error:
        return ns_error_response(error)
    trips = [
        t
        for t in trips
        if (max_duration_minutes is None or t.duration_minutes <= max_duration_minutes)
        and (max_transfers is None or t.transfers <= max_transfers)
    ]
    advice = ns.advise(trips, now)
    return Response(
        {
            "fetched_at": now,
            "trips": TripSerializer(trips, many=True).data,
            "recommended_uid": advice.recommended_uid,
            "wait_minutes": advice.wait_minutes,
        }
    )


class CommuteViewSet(viewsets.ModelViewSet[Commute]):
    serializer_class = CommuteSerializer

    def get_queryset(self) -> QuerySet[Commute]:
        return Commute.objects.filter(user=cast(User, self.request.user))

    def perform_create(self, serializer: BaseSerializer[Commute]) -> None:
        serializer.save(user=self.request.user)

    @extend_schema(responses={200: CommuteTripsSerializer, 502: None, 503: None})
    @action(detail=True, methods=["get"])
    def trips(self, request: Request, pk: str | None = None) -> Response:
        """Upcoming trips for this commute within its saved filters, and which one to take."""
        commute = self.get_object()
        return trips_response(
            commute.origin_code,
            commute.destination_code,
            commute.max_duration_minutes,
            commute.max_transfers,
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


@extend_schema(
    parameters=[
        OpenApiParameter("from", str, required=True, description="Origin station code"),
        OpenApiParameter("to", str, required=True, description="Destination station code"),
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
    return trips_response(origin, destination)


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
    user = authenticate(
        request._request,
        username=serializer.validated_data["username"],
        password=serializer.validated_data["password"],
    )
    if user is None:
        return Response(
            {"detail": "Invalid username or password."}, status=status.HTTP_400_BAD_REQUEST
        )
    login(request._request, user)
    return Response(UserSerializer(user).data)


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
