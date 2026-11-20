from typing import cast

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.db.models import QuerySet
from django.http import FileResponse, Http404, HttpRequest
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

from api import ns
from api.models import Commute
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


class CommuteViewSet(viewsets.ModelViewSet[Commute]):
    serializer_class = CommuteSerializer

    def get_queryset(self) -> QuerySet[Commute]:
        return Commute.objects.filter(user=cast(User, self.request.user))

    def perform_create(self, serializer: BaseSerializer[Commute]) -> None:
        serializer.save(user=self.request.user)

    @extend_schema(responses={200: CommuteTripsSerializer, 502: None, 503: None})
    @action(detail=True, methods=["get"])
    def trips(self, request: Request, pk: str | None = None) -> Response:
        """Upcoming trips for this commute, with delays, and which one to take."""
        commute = self.get_object()
        now = timezone.now()
        try:
            trips = ns.fetch_trips(commute.origin_code, commute.destination_code, now)
        except ns.NsError as error:
            return ns_error_response(error)
        advice = ns.advise(trips, now)
        return Response(
            {
                "fetched_at": now,
                "trips": TripSerializer(trips, many=True).data,
                "recommended_uid": advice.recommended_uid,
                "wait_minutes": advice.wait_minutes,
            }
        )


@extend_schema(
    parameters=[OpenApiParameter("q", str, description="Part of a station name or its code")],
    responses={200: StationSerializer(many=True), 502: None, 503: None},
)
@api_view(["GET"])
def stations(request: Request) -> Response:
    """Search NS stations by name or code, for the commute form."""
    try:
        found = ns.search_stations(request.query_params.get("q", ""))
    except ns.NsError as error:
        return ns_error_response(error)
    return Response(StationSerializer(found, many=True).data)


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
