"""When to plan trips from, and the service that plans them. Knows nothing about HTTP."""

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from api import ns

DUTCH_TIME_ZONE = ZoneInfo("Europe/Amsterdam")
USUAL_TIME_LEAD = timedelta(minutes=15)
WAIT_ADVICE_HORIZON = timedelta(minutes=60)


@dataclass(frozen=True)
class TripPlan:
    fetched_at: datetime
    planned_from: datetime
    planned_from_usual_time: bool
    planned_tomorrow: bool
    trips: list[ns.Trip]
    recommended_uid: str | None
    wait_minutes: int | None


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


def plan_trips(
    origin_code: str,
    destination_code: str,
    max_duration_minutes: int | None = None,
    max_transfers: int | None = None,
    usual_time: time | None = None,
    requested_time: time | None = None,
    around: bool = False,
    arrive: bool = False,
) -> TripPlan:
    """The upcoming trips between two stations and which one to take.

    Raises `ns.NsError` when the NS API cannot answer.
    """
    now = timezone.now()
    tomorrow = False
    if requested_time is not None:
        around = around and not arrive
        planned_from, tomorrow = requested_planning_time(requested_time, now, around)
        usual_from = planned_from if around else None
    else:
        usual_from = usual_planning_time(usual_time, now)
        planned_from = usual_from or now
    trips = ns.fetch_trips(
        origin_code, destination_code, planned_from, max_duration_minutes, max_transfers, arrive
    )
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
    return TripPlan(
        fetched_at=now,
        planned_from=planned_from,
        planned_from_usual_time=usual_from is not None,
        planned_tomorrow=tomorrow,
        trips=trips,
        recommended_uid=advice.recommended_uid,
        wait_minutes=wait_minutes,
    )
