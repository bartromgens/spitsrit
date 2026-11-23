from datetime import UTC, datetime
from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from api import ns
from tests.test_ns import make_trip


def _plan_at(
    logged_in: APIClient,
    monkeypatch: pytest.MonkeyPatch,
    now: datetime,
    query: str,
    leaves_in: int = 10,
) -> tuple[datetime, dict[str, Any]]:
    asked: list[datetime] = []

    def fake_fetch(
        origin: str, destination: str, when: datetime, *filters: int | None
    ) -> list[ns.Trip]:
        asked.append(when)
        return [make_trip("a", leaves_in, base=now)]

    monkeypatch.setattr(ns, "fetch_trips", fake_fetch)
    monkeypatch.setattr(timezone, "now", lambda: now)
    response = logged_in.get(f"/api/trips/?from=UT&to=ASD&{query}")
    assert response.status_code == 200
    return asked[0], response.json()


def test_plan_trip_without_time_plans_from_now(
    logged_in: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime(2026, 11, 20, 6, 15, tzinfo=UTC)
    asked, body = _plan_at(logged_in, monkeypatch, now, "")
    assert asked == now
    assert body["planned_tomorrow"] is False
    assert body["planned_from_usual_time"] is False


def test_plan_trip_time_later_today(logged_in: APIClient, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime(2026, 11, 20, 6, 15, tzinfo=UTC)  # 07:15 in Amsterdam (CET)
    asked, body = _plan_at(logged_in, monkeypatch, now, "time=07:15")
    assert asked == datetime(2026, 11, 20, 6, 15, tzinfo=UTC)  # equal to now is today
    assert body["planned_tomorrow"] is False
    asked, body = _plan_at(logged_in, monkeypatch, now, "time=16:00")
    assert asked == datetime(2026, 11, 20, 15, 0, tzinfo=UTC)
    assert body["planned_tomorrow"] is False
    assert body["planned_from_usual_time"] is False


def test_plan_trip_time_earlier_than_now_is_tomorrow(
    logged_in: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime(2026, 11, 20, 6, 15, tzinfo=UTC)
    asked, body = _plan_at(logged_in, monkeypatch, now, "time=07:00")
    assert asked == datetime(2026, 11, 21, 6, 0, tzinfo=UTC)
    assert body["planned_tomorrow"] is True


def test_plan_trip_around_plans_15_minutes_earlier(
    logged_in: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime(2026, 11, 20, 6, 15, tzinfo=UTC)
    asked, body = _plan_at(logged_in, monkeypatch, now, "time=16:00&around=1")
    assert asked == datetime(2026, 11, 20, 14, 45, tzinfo=UTC)
    assert body["planned_from_usual_time"] is True


def test_plan_trip_omits_the_wait_advice_when_planned_far_ahead(
    logged_in: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime(2026, 11, 20, 6, 15, tzinfo=UTC)
    _, soon = _plan_at(logged_in, monkeypatch, now, "time=08:15", leaves_in=60)
    assert soon["wait_minutes"] == 60  # planned exactly 60 minutes ahead
    _, later = _plan_at(logged_in, monkeypatch, now, "time=08:16", leaves_in=61)
    assert later["wait_minutes"] is None
    assert later["recommended_uid"] == "a"


def test_plan_trip_keeps_the_wall_clock_across_a_clock_change(
    logged_in: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Saturday 2026-03-28 23:30 CET; the clocks go forward in the night, so 08:00 CEST is 06:00Z.
    now = datetime(2026, 3, 28, 22, 30, tzinfo=UTC)
    asked, body = _plan_at(logged_in, monkeypatch, now, "time=08:00")
    assert asked == datetime(2026, 3, 29, 6, 0, tzinfo=UTC)
    assert body["planned_tomorrow"] is True
    # Today after the change: 2026-03-29 10:00 CEST is 08:00Z.
    now = datetime(2026, 3, 29, 7, 0, tzinfo=UTC)
    asked, _ = _plan_at(logged_in, monkeypatch, now, "time=10:00")
    assert asked == datetime(2026, 3, 29, 8, 0, tzinfo=UTC)


@pytest.mark.parametrize("query", ["time=8", "time=25:00", "time=abc", "time=08:00:00"])
def test_plan_trip_rejects_an_invalid_time(logged_in: APIClient, query: str) -> None:
    assert logged_in.get(f"/api/trips/?from=UT&to=ASD&{query}").status_code == 400
