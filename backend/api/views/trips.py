from datetime import datetime, time
from typing import cast

from django.contrib.auth.models import User
from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

from api import ns
from api.models import Commute
from api.planning import plan_trips
from api.serializers import CommuteSerializer, CommuteTripsSerializer, TripSerializer
from api.views.common import ns_error_response


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
    """Plan the trips and serialise the plan."""
    try:
        plan = plan_trips(
            origin_code,
            destination_code,
            max_duration_minutes,
            max_transfers,
            usual_time,
            requested_time,
            around,
            arrive,
        )
    except ns.NsError as error:
        return ns_error_response(error)
    return Response(
        {
            "fetched_at": plan.fetched_at,
            "planned_from": plan.planned_from,
            "planned_from_usual_time": plan.planned_from_usual_time,
            "planned_tomorrow": plan.planned_tomorrow,
            "trips": TripSerializer(plan.trips, many=True).data,
            "recommended_uid": plan.recommended_uid,
            "wait_minutes": plan.wait_minutes,
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


def _int_param(request: Request, name: str, minimum: int) -> int | Response | None:
    """A whole-number query parameter, None when absent, or a 400 response when invalid."""
    raw = request.query_params.get(name, "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        value = minimum - 1
    if value < minimum:
        kind = "a positive" if minimum > 0 else "a non-negative"
        return Response(
            {"detail": f"'{name}' must be {kind} whole number."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return value


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
        OpenApiParameter(
            "max_duration", int, description="Only trips of at most this many minutes (positive)"
        ),
        OpenApiParameter(
            "max_transfers", int, description="Only trips with at most this many transfers (0+)"
        ),
        OpenApiParameter(
            "usual",
            str,
            description=(
                "Usual departure time as HH:MM, Dutch local time: plans from 15 minutes before it "
                "while that is still ahead today, otherwise from now. Ignored when `time` is given"
            ),
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
    usual_time: time | None = None
    raw_usual = request.query_params.get("usual", "").strip()
    if raw_usual:
        try:
            usual_time = datetime.strptime(raw_usual, "%H:%M").time()
        except ValueError:
            return Response(
                {"detail": "'usual' must be HH:MM."}, status=status.HTTP_400_BAD_REQUEST
            )
    max_duration = _int_param(request, "max_duration", minimum=1)
    max_transfers = _int_param(request, "max_transfers", minimum=0)
    if isinstance(max_duration, Response):
        return max_duration
    if isinstance(max_transfers, Response):
        return max_transfers
    return trips_response(
        origin,
        destination,
        max_duration,
        max_transfers,
        usual_time,
        requested_time=requested_time,
        around=around,
        arrive=arrive,
    )
