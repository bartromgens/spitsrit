from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from api import ns, planning

AMSTERDAM = ZoneInfo("Europe/Amsterdam")
NOW = datetime(2026, 3, 4, 8, 0, tzinfo=AMSTERDAM)


def make_trip(uid: str, leaves_in: int, rides: int = 30) -> ns.Trip:
    departure = NOW + timedelta(minutes=leaves_in)
    arrival = departure + timedelta(minutes=rides)
    return ns.Trip(
        uid=uid,
        departure_planned=departure,
        departure_actual=departure,
        arrival_planned=arrival,
        arrival_actual=arrival,
        departure_track="1",
        transfers=0,
        status="NORMAL",
        cancelled=False,
        crowd_forecast="LOW",
        train="IC 1",
    )


def test_usual_planning_time_is_15_minutes_before_while_ahead() -> None:
    assert planning.usual_planning_time(time(8, 30), NOW) == NOW + timedelta(minutes=15)


def test_usual_planning_time_is_none_when_past_or_unset() -> None:
    assert planning.usual_planning_time(time(7, 59), NOW) is None
    assert planning.usual_planning_time(None, NOW) is None


def test_requested_planning_time_rolls_over_to_tomorrow() -> None:
    planned, tomorrow = planning.requested_planning_time(time(7, 0), NOW, around=False)
    assert tomorrow
    assert planned == datetime(2026, 3, 5, 7, 0, tzinfo=AMSTERDAM)


def test_requested_planning_time_around_leads_by_15_minutes() -> None:
    planned, tomorrow = planning.requested_planning_time(time(9, 0), NOW, around=True)
    assert not tomorrow
    assert planned == datetime(2026, 3, 4, 8, 45, tzinfo=AMSTERDAM)


@pytest.fixture
def fixed_now(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(timezone, "now", lambda: NOW)


def test_plan_trips_returns_the_plan_and_advice(
    monkeypatch: pytest.MonkeyPatch, fixed_now: None
) -> None:
    trips = [make_trip("slow", 5, rides=60), make_trip("fast", 10)]
    monkeypatch.setattr(ns, "fetch_trips", lambda *args: trips)
    plan = planning.plan_trips("UT", "ASD")
    assert plan.trips == trips
    assert plan.planned_from == NOW
    assert not plan.planned_from_usual_time
    assert not plan.planned_tomorrow
    assert (plan.recommended_uid, plan.wait_minutes) == ("fast", 10)


def test_plan_trips_drops_trips_outside_the_filters(
    monkeypatch: pytest.MonkeyPatch, fixed_now: None
) -> None:
    trips = [make_trip("long", 5, rides=90), make_trip("short", 20)]
    monkeypatch.setattr(ns, "fetch_trips", lambda *args: trips)
    plan = planning.plan_trips("UT", "ASD", max_duration_minutes=60)
    assert [t.uid for t in plan.trips] == ["short"]


def test_plan_trips_hides_the_wait_for_a_far_away_plan(
    monkeypatch: pytest.MonkeyPatch, fixed_now: None
) -> None:
    monkeypatch.setattr(ns, "fetch_trips", lambda *args: [make_trip("later", 125)])
    plan = planning.plan_trips("UT", "ASD", requested_time=time(10, 0))
    assert plan.recommended_uid == "later"
    assert plan.wait_minutes is None


def test_plan_trips_lets_ns_errors_through(
    monkeypatch: pytest.MonkeyPatch, fixed_now: None
) -> None:
    def fail(*args: object) -> list[ns.Trip]:
        raise ns.NsError("boom")

    monkeypatch.setattr(ns, "fetch_trips", fail)
    with pytest.raises(ns.NsError):
        planning.plan_trips("UT", "ASD")
