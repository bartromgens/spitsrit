import io
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from django.core.cache import cache
from django.test import override_settings

from api import ns

NOW = datetime(2026, 11, 20, 8, 0, tzinfo=UTC)


def make_trip(
    uid: str,
    leaves_in: int,
    duration: int = 30,
    delay: int = 0,
    cancelled: bool = False,
    base: datetime = NOW,
) -> ns.Trip:
    departure = base + timedelta(minutes=leaves_in)
    arrival = departure + timedelta(minutes=duration)
    return ns.Trip(
        uid=uid,
        departure_planned=departure - timedelta(minutes=delay),
        departure_actual=departure,
        arrival_planned=arrival - timedelta(minutes=delay),
        arrival_actual=arrival,
        departure_track="5",
        transfers=0,
        status="NORMAL",
        cancelled=cancelled,
        crowd_forecast="LOW",
        train="IC 1234",
    )


def test_advise_prefers_earliest_arrival() -> None:
    slow_now = make_trip("slow", leaves_in=0, duration=50)
    fast_later = make_trip("fast", leaves_in=10, duration=30)
    advice = ns.advise([slow_now, fast_later], NOW)
    assert advice == ns.Advice("fast", 10)


def test_advise_leave_now_when_first_trip_is_best() -> None:
    advice = ns.advise([make_trip("a", 2), make_trip("b", 15)], NOW)
    assert advice == ns.Advice("a", 2)


def test_advise_skips_cancelled_and_departed_trips() -> None:
    trips = [make_trip("gone", -5), make_trip("cancelled", 3, cancelled=True), make_trip("ok", 20)]
    assert ns.advise(trips, NOW) == ns.Advice("ok", 20)


def test_advise_without_candidates() -> None:
    assert ns.advise([], NOW) == ns.Advice(None, None)
    assert ns.advise([make_trip("c", 3, cancelled=True)], NOW) == ns.Advice(None, None)


def test_advise_tie_takes_latest_departure() -> None:
    early = make_trip("early", 0, duration=40)
    late = make_trip("late", 10, duration=30)
    assert ns.advise([early, late], NOW).recommended_uid == "late"


def test_trip_delays_and_duration() -> None:
    trip = make_trip("a", 5, duration=30, delay=4)
    assert trip.departure_delay_minutes == 4
    assert trip.arrival_delay_minutes == 4
    assert trip.duration_minutes == 30


TRIP_ITEM: dict[str, Any] = {
    "uid": "abc",
    "transfers": 1,
    "status": "NORMAL",
    "crowdForecast": "MEDIUM",
    "legs": [
        {
            "origin": {
                "plannedDateTime": "2026-11-20T08:00:00+0100",
                "actualDateTime": "2026-11-20T08:03:00+0100",
                "plannedTrack": "5",
                "actualTrack": "6",
            },
            "destination": {"plannedDateTime": "2026-11-20T08:20:00+0100"},
            "product": {"shortCategoryName": "IC", "number": "2736"},
        },
        {
            "origin": {"plannedDateTime": "2026-11-20T08:25:00+0100"},
            "destination": {
                "plannedDateTime": "2026-11-20T08:50:00+0100",
                "actualDateTime": "2026-11-20T08:55:00+0100",
            },
            "product": {"shortCategoryName": "SPR", "number": "5"},
            "cancelled": False,
        },
    ],
}


def test_parse_trip() -> None:
    trip = ns.parse_trip(TRIP_ITEM)
    assert trip is not None
    assert trip.uid == "abc"
    assert trip.departure_delay_minutes == 3
    assert trip.arrival_delay_minutes == 5
    assert trip.departure_track == "6"
    assert trip.transfers == 1
    assert trip.train == "IC 2736"
    assert trip.crowd_forecast == "MEDIUM"
    assert not trip.cancelled


def test_parse_trip_marks_cancelled_legs() -> None:
    item = {**TRIP_ITEM, "legs": [{**TRIP_ITEM["legs"][0], "cancelled": True}]}
    trip = ns.parse_trip(item)
    assert trip is not None
    assert trip.cancelled


def test_parse_trip_without_legs_or_times_is_dropped() -> None:
    assert ns.parse_trip({"legs": []}) is None
    assert ns.parse_trip({"legs": [{"origin": {}, "destination": {}}]}) is None


def test_parse_stations_skips_incomplete_entries() -> None:
    payload = {
        "payload": [
            {"code": "UT", "namen": {"lang": "Utrecht Centraal"}},
            {"code": "XX"},
            {"namen": {"lang": "Nameless"}},
        ]
    }
    assert ns.parse_stations(payload) == [ns.Station("UT", "Utrecht Centraal")]


STATIONS = [
    ns.Station("UT", "Utrecht Centraal"),
    ns.Station("UTLR", "Utrecht Leidsche Rijn"),
    ns.Station("ASD", "Amsterdam Centraal"),
    ns.Station("DUT", "Duitsland-Utrecht"),
]


def test_search_stations_ranks_code_then_prefix_then_substring(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ns, "fetch_stations", lambda: STATIONS)
    names = [s.name for s in ns.search_stations("ut")]
    assert names == ["Utrecht Centraal", "Utrecht Leidsche Rijn", "Duitsland-Utrecht"]
    assert ns.search_stations("   ") == []


def test_fetch_stations_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    cache.clear()
    calls: list[str] = []

    def fake_get(path: str, params: dict[str, str] | None = None) -> Any:
        calls.append(path)
        return {"payload": [{"code": "UT", "namen": {"lang": "Utrecht Centraal"}}]}

    monkeypatch.setattr(ns, "_get", fake_get)
    assert ns.fetch_stations() == ns.fetch_stations() == [ns.Station("UT", "Utrecht Centraal")]
    assert calls == ["v2/stations"]
    cache.clear()


def test_fetch_trips_limits_and_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    def fake_get(path: str, params: dict[str, str] | None = None) -> Any:
        seen.update(path=path, params=params)
        return {"trips": [TRIP_ITEM] * 10 + [{"legs": []}]}

    monkeypatch.setattr(ns, "_get", fake_get)
    trips = ns.fetch_trips("UT", "ASD", NOW)
    assert len(trips) == ns.MAX_TRIPS
    assert seen["path"] == "v3/trips"
    assert seen["params"]["fromStation"] == "UT"
    assert seen["params"]["toStation"] == "ASD"


@override_settings(NS_API_KEY="")
def test_get_without_key_raises() -> None:
    with pytest.raises(ns.NsNotConfigured):
        ns.fetch_trips("UT", "ASD", NOW)


@override_settings(NS_API_KEY="k")
def test_get_wraps_network_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: Any, **kwargs: Any) -> Any:
        raise urllib.error.URLError("down")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    with pytest.raises(ns.NsError):
        ns.fetch_trips("UT", "ASD", NOW)


@override_settings(NS_API_KEY="secret-key")
def test_get_sends_key_header_and_parses_json(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[urllib.request.Request] = []

    def fake_urlopen(request: urllib.request.Request, timeout: int) -> io.BytesIO:
        captured.append(request)
        return io.BytesIO(b'{"trips": []}')

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    assert ns.fetch_trips("UT", "ASD", NOW) == []
    assert captured[0].get_header("Ocp-apim-subscription-key") == "secret-key"
    assert "fromStation=UT" in captured[0].full_url
