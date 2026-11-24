import io
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import sentry_sdk
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone

from api import ns, places, planning
from api.ns import budget, trips

from .test_ns_leg_journeys import JOURNEYS, item, train

CLOCK = datetime(2026, 11, 20, 8, 0, tzinfo=UTC)


class Clock:
    """A fixed clock for Django's `timezone.now` and the budget window."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.now = CLOCK
        monkeypatch.setattr(timezone, "now", lambda: self.now)
        monkeypatch.setattr(budget, "_now", lambda: self.now.timestamp())

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    cache.clear()
    return Clock(monkeypatch)


def leg_leaving_in(clock: Clock, minutes: int) -> dict[str, Any]:
    leg = train("A", "8400621", "8400282", 0)
    leg["origin"]["plannedDateTime"] = (clock.now + timedelta(minutes=minutes)).isoformat()
    return leg


def mock_ns(monkeypatch: pytest.MonkeyPatch, trip_items: list[dict[str, Any]]) -> list[str]:
    """Mock NS: the trips, and the journey of train A. Returns the paths asked."""
    asked: list[str] = []

    def fake_get(path: str, params: dict[str, str] | None = None) -> Any:
        asked.append(path)
        budget.record_call()
        return {"trips": trip_items} if path == "v3/trips" else JOURNEYS["A"]

    monkeypatch.setattr(ns.client, "get", fake_get)
    return asked


class SpyCache:
    """The Django cache that records the timeout of every `set`."""

    def __init__(self) -> None:
        self.timeouts: dict[str, int] = {}

    def __getattr__(self, name: str) -> Any:
        return getattr(cache, name)

    def set(self, key: str, value: Any, timeout: int) -> None:
        self.timeouts[key] = timeout
        cache.set(key, value, timeout)


def spy_cache_set(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    spy = SpyCache()
    monkeypatch.setattr(trips, "cache", spy)
    return spy.timeouts


def fake_places(asked: list[str]) -> Any:
    def get_json(url: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        asked.append(url)
        return {}

    return get_json


def capture_sentry(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str | None]]:
    messages: list[tuple[str, str | None]] = []

    def capture_message(message: str, level: str | None = None) -> None:
        messages.append((message, level))

    monkeypatch.setattr(sentry_sdk, "capture_message", capture_message)
    return messages


@pytest.mark.parametrize(("minutes", "seconds"), [(5, 60), (10, 60), (30, 300)])
def test_journey_cache_time_depends_on_departure(
    monkeypatch: pytest.MonkeyPatch, clock: Clock, minutes: int, seconds: int
) -> None:
    mock_ns(monkeypatch, [item("t", leg_leaving_in(clock, minutes))])
    timeouts = spy_cache_set(monkeypatch)
    ns.fetch_trips("UT", "ASD", clock.now)
    [journey_timeout] = [t for k, t in timeouts.items() if k.startswith("ns:journey:")]
    assert journey_timeout == seconds


def test_identical_search_within_a_minute_makes_no_ns_calls(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    asked = mock_ns(monkeypatch, [item("t", leg_leaving_in(clock, 30))])
    first = ns.fetch_trips("UT", "ASD", clock.now)
    assert asked == ["v3/trips", "v2/journey"]
    clock.advance(seconds=30)
    assert ns.fetch_trips("UT", "ASD", clock.now) == first
    assert len(asked) == 2


def test_search_one_minute_later_calls_ns_again(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    asked = mock_ns(monkeypatch, [item("t", leg_leaving_in(clock, 30))])
    ns.fetch_trips("UT", "ASD", clock.now)
    clock.advance(minutes=1)
    ns.fetch_trips("UT", "ASD", clock.now)
    # The journey (30 minutes away) is still cached; the search is not.
    assert asked == ["v3/trips", "v2/journey", "v3/trips"]


def test_search_cache_key_includes_the_filters_and_direction(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    asked = mock_ns(monkeypatch, [item("t", leg_leaving_in(clock, 30))])
    ns.fetch_trips("UT", "ASD", clock.now)
    ns.fetch_trips("UT", "ASD", clock.now, max_transfers=1)
    ns.fetch_trips("UT", "ASD", clock.now, max_duration_minutes=90)
    ns.fetch_trips("UT", "ASD", clock.now, arrive=True)
    ns.fetch_trips("ASD", "UT", clock.now)
    assert asked.count("v3/trips") == 5


def test_advice_is_computed_from_the_current_time_for_a_cached_search(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    trip_item = {
        **item("t", leg_leaving_in(clock, 20)),
        "legs": [
            {
                **leg_leaving_in(clock, 20),
                "origin": {
                    "uicCode": "8400621",
                    "plannedDateTime": (clock.now + timedelta(minutes=20)).isoformat(),
                    "actualDateTime": (clock.now + timedelta(minutes=20)).isoformat(),
                },
                "destination": {
                    "uicCode": "8400282",
                    "plannedDateTime": (clock.now + timedelta(minutes=50)).isoformat(),
                    "actualDateTime": (clock.now + timedelta(minutes=50)).isoformat(),
                },
            }
        ],
    }
    asked = mock_ns(monkeypatch, [trip_item])
    first = planning.plan_trips("UT", "ASD")
    clock.advance(seconds=40)
    second = planning.plan_trips("UT", "ASD")
    assert asked.count("v3/trips") == 1
    assert (first.wait_minutes, second.wait_minutes) == (20, 19)
    assert second.fetched_at == clock.now


def test_over_the_journey_limit_trips_still_return_with_unknown_sizes(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    asked = mock_ns(monkeypatch, [item("t", leg_leaving_in(clock, 30))])
    for _ in range(251):
        budget.record_call()
    [trip] = ns.fetch_trips("UT", "ASD", clock.now)
    assert asked == ["v3/trips"]
    assert (trip.seats, trip.carriages) == (None, None)


def test_at_the_journey_limit_journeys_are_still_looked_up(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    asked = mock_ns(monkeypatch, [item("t", leg_leaving_in(clock, 30))])
    for _ in range(249):  # the trips call makes it 250
        budget.record_call()
    [trip] = ns.fetch_trips("UT", "ASD", clock.now)
    assert asked == ["v3/trips", "v2/journey"]
    assert trip.seats is not None


def test_a_cached_journey_is_used_over_the_limit(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    asked = mock_ns(monkeypatch, [item("t", leg_leaving_in(clock, 30))])
    ns.fetch_trips("UT", "ASD", clock.now)
    for _ in range(300):
        budget.record_call()
    clock.advance(minutes=1)
    [trip] = ns.fetch_trips("UT", "ASD", clock.now)
    assert asked == ["v3/trips", "v2/journey", "v3/trips"]
    assert trip.seats is not None


def test_over_the_places_limit_places_calls_are_skipped(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    asked: list[str] = []
    monkeypatch.setattr(ns, "get_json", fake_places(asked))
    for _ in range(291):
        budget.record_call()
    with pytest.raises(ns.NsError):
        places.fetch_ov_fiets("UT")
    with pytest.raises(ns.NsError):
        places.fetch_toilets("UT")
    assert asked == []


def test_places_calls_go_through_between_the_limits(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    asked: list[str] = []
    monkeypatch.setattr(ns, "get_json", fake_places(asked))
    for _ in range(280):
        budget.record_call()
    places.fetch_ov_fiets("UT")
    assert len(asked) == 1


def test_the_window_rolls_over_after_five_minutes(clock: Clock) -> None:
    for _ in range(260):
        budget.record_call()
    assert not budget.allow_journeys()
    clock.advance(minutes=4, seconds=30)
    assert not budget.allow_journeys()
    clock.advance(seconds=45)
    assert budget.call_count() == 0
    assert budget.allow_journeys()


def test_limits_are_settings(clock: Clock) -> None:
    for _ in range(10):
        budget.record_call()
    with override_settings(NS_JOURNEY_CALL_LIMIT=5, NS_PLACES_CALL_LIMIT=20):
        assert not budget.allow_journeys()
        assert budget.allow_places()


def test_skips_are_reported_to_sentry_once_a_minute(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    messages = capture_sentry(monkeypatch)
    for _ in range(260):
        budget.record_call()
    budget.allow_journeys()
    budget.allow_journeys()
    assert len(messages) == 1
    assert "260 calls" in messages[0][0]
    assert messages[0][1] == "warning"
    clock.advance(seconds=61)
    budget.allow_journeys()
    assert len(messages) == 2


@override_settings(NS_API_KEY="k")
def test_a_429_is_reported_to_sentry_and_handled_like_other_errors(
    monkeypatch: pytest.MonkeyPatch, clock: Clock
) -> None:
    messages = capture_sentry(monkeypatch)

    def too_many(*args: Any, **kwargs: Any) -> Any:
        raise urllib.error.HTTPError("u", 429, "Too Many Requests", None, io.BytesIO(b""))  # type: ignore[arg-type]  # headers are unused

    monkeypatch.setattr(urllib.request, "urlopen", too_many)
    with pytest.raises(ns.NsError):
        ns.fetch_trips("UT", "ASD", clock.now)
    assert len(messages) == 1
    assert "429" in messages[0][0]
    assert messages[0][1] == "warning"
    assert budget.call_count() == 1


@override_settings(NS_API_KEY="k")
def test_other_http_errors_are_not_reported(monkeypatch: pytest.MonkeyPatch, clock: Clock) -> None:
    messages = capture_sentry(monkeypatch)

    def server_error(*args: Any, **kwargs: Any) -> Any:
        raise urllib.error.HTTPError("u", 500, "Boom", None, io.BytesIO(b""))  # type: ignore[arg-type]  # headers are unused

    monkeypatch.setattr(urllib.request, "urlopen", server_error)
    with pytest.raises(ns.NsError):
        ns.fetch_trips("UT", "ASD", clock.now)
    assert messages == []


def test_call_count_survives_a_cache_holding_many_entries(clock: Clock) -> None:
    for _ in range(5):
        budget.record_call()
    for i in range(400):
        cache.set(f"ns:journey:filler:{i}", i, 600)
    assert budget.call_count() == 5
