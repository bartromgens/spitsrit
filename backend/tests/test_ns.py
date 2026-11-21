import io
import json
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
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
            "travelType": "PUBLIC_TRANSIT",
            "journeyDetailRef": "1|231691|0|784|20112026",
            "origin": {
                "uicCode": "8400621",
                "plannedDateTime": "2026-11-20T08:00:00+0100",
                "actualDateTime": "2026-11-20T08:03:00+0100",
                "plannedTrack": "5",
                "actualTrack": "6",
            },
            "destination": {"plannedDateTime": "2026-11-20T08:20:00+0100"},
            "product": {"shortCategoryName": "IC", "number": "2736"},
        },
        {
            "travelType": "PUBLIC_TRANSIT",
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
    assert trip.seats is None
    assert trip.shorter_stock is None
    assert trip.crowd_forecast == "MEDIUM"
    assert not trip.cancelled


def test_parse_trip_marks_cancelled_legs() -> None:
    item = {**TRIP_ITEM, "legs": [{**TRIP_ITEM["legs"][0], "cancelled": True}]}
    trip = ns.parse_trip(item)
    assert trip is not None
    assert trip.cancelled


def test_parse_trip_passes_shorter_stock_flags_through() -> None:
    shorter = {
        **TRIP_ITEM["legs"][1],
        "shorterStock": True,
        "shorterStockClassification": "EXTRA_BUSY",
        "shorterStockWarning": "Kortere trein dan normaal",
    }
    trip = ns.parse_trip({**TRIP_ITEM, "legs": [TRIP_ITEM["legs"][0], shorter]})
    assert trip is not None
    assert trip.shorter_stock == "EXTRA_BUSY"
    assert trip.shorter_stock_warning == "Kortere trein dan normaal"


def stop(uic: str, kind: str | None = None, **stock: Any) -> dict[str, Any]:
    return {"id": uic, "stop": {"uicCode": uic}, **({"kind": kind} if kind else {}), **stock}


def stock(seats: int, parts: int = 3, train_type: str = "VIRM") -> dict[str, Any]:
    return {
        "hasSignificantChange": False,
        "numberOfParts": parts,
        "numberOfSeats": seats,
        "trainParts": [],
        "trainType": train_type,
    }


def journey(*stops: dict[str, Any]) -> dict[str, Any]:
    return {"payload": {"productNumbers": ["2736"], "stops": list(stops)}}


def trips_with_journey(
    monkeypatch: pytest.MonkeyPatch, journeys: Any, item: dict[str, Any] = TRIP_ITEM
) -> list[tuple[str, dict[str, str] | None]]:
    """Mock NS: one trip, and `journeys` (a payload, or a callable raising) for /v2/journey."""
    calls: list[tuple[str, dict[str, str] | None]] = []

    def fake_get(path: str, params: dict[str, str] | None = None) -> Any:
        calls.append((path, params))
        if path == "v3/trips":
            return {"trips": [item]}
        if isinstance(journeys, Exception):
            raise journeys
        return journeys

    cache.clear()
    monkeypatch.setattr(ns, "_get", fake_get)
    return calls


def test_fetch_trips_reads_size_from_the_boarding_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    # The train starts at 8400000; the leg boards at 8400621, where it has more carriages.
    # `kind` is absent, so the stop is found by its `uicCode`; actualStock beats plannedStock.
    payload = journey(
        stop("8400000", plannedStock=stock(300, 2, "SLT")),
        stop("8400621", actualStock=stock(620, 4, "VIRM"), plannedStock=stock(400, 3, "DDZ")),
    )
    trips_with_journey(monkeypatch, payload)
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert (trip.seats, trip.carriages, trip.train_type) == (620, 4, "VIRM")


def test_fetch_trips_sends_the_departure_uic_code_by_journey_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = trips_with_journey(monkeypatch, journey(stop("8400621", actualStock=stock(620))))
    ns.fetch_trips("UT", "ASD", NOW)
    assert ("v2/journey", {"id": "1|231691|0|784|20112026", "departureUicCode": "8400621"}) in calls


def test_the_departure_stop_wins_over_a_matching_uic_code(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = journey(
        stop("8400621", actualStock=stock(100)), stop("2", "DEPARTURE", actualStock=stock(250))
    )
    trips_with_journey(monkeypatch, payload)
    assert ns.fetch_trips("UT", "ASD", NOW)[0].seats == 250


def test_parse_boarding_stock_from_the_real_journey_response() -> None:
    fixture = Path(__file__).parent / "fixtures" / "ns_journey_3148.json"
    stops = json.loads(fixture.read_text())["payload"]["stops"]
    # Utrecht Centraal: 740 seats, not the 810 of the final stop; 8 carriages in 2 units.
    assert ns.parse_boarding_stock(stops, "8400621") == ns.Stock(740, 8, "VIRM")
    # Without `kind`, the stop is found by uicCode alone.
    unmarked = [{k: v for k, v in s.items() if k != "kind"} for s in stops]
    assert ns.parse_boarding_stock(unmarked, "8400621") == ns.Stock(740, 8, "VIRM")
    assert ns.parse_boarding_stock(unmarked, "8400282") == ns.Stock(810, 8, "VIRM")
    assert ns.parse_boarding_stock(unmarked, "9999999") is None


def test_parse_boarding_stock_prefers_actual_over_planned_stock() -> None:
    stops = [stop("8400621", actualStock=stock(700, 8), plannedStock=stock(400, 4))]
    assert ns.parse_boarding_stock(stops, "8400621") == ns.Stock(700, 8, "VIRM")


def test_fetch_trips_falls_back_to_planned_stock(monkeypatch: pytest.MonkeyPatch) -> None:
    trips_with_journey(monkeypatch, journey(stop("8400621", plannedStock=stock(400, 3, "DDZ"))))
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert (trip.seats, trip.carriages, trip.train_type) == (400, 3, "DDZ")


def test_fetch_trips_uses_the_departure_stop_when_uic_does_not_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = journey(
        stop("1", plannedStock=stock(100)), stop("2", "DEPARTURE", actualStock=stock(250))
    )
    trips_with_journey(monkeypatch, payload)
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.seats == 250


def test_fetch_trips_falls_back_to_train_number(monkeypatch: pytest.MonkeyPatch) -> None:
    leg = {k: v for k, v in TRIP_ITEM["legs"][0].items() if k != "journeyDetailRef"}
    calls = trips_with_journey(
        monkeypatch, journey(stop("8400621", actualStock=stock(500))), {**TRIP_ITEM, "legs": [leg]}
    )
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.seats == 500
    assert (
        "v2/journey",
        {
            "train": "2736",
            "dateTime": "2026-11-20T08:00:00+0100",
            "departureUicCode": "8400621",
        },
    ) in calls


def test_failed_journey_leaves_size_unknown_but_returns_the_trip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trips_with_journey(monkeypatch, ns.NsError("boom"))
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.uid == "abc"
    assert (trip.seats, trip.carriages, trip.train_type) == (None, None, None)


def test_malformed_journey_leaves_size_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    trips_with_journey(monkeypatch, {"payload": None})
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.seats is None


def test_journey_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = trips_with_journey(monkeypatch, journey(stop("8400621", actualStock=stock(620))))
    assert ns.fetch_trips("UT", "ASD", NOW)[0].seats == 620
    assert ns.fetch_trips("UT", "ASD", NOW)[0].seats == 620
    assert [path for path, _ in calls].count("v2/journey") == 1
    cache.clear()


def test_parse_train_origin_from_the_real_journey_response() -> None:
    fixture = Path(__file__).parent / "fixtures" / "ns_journey_3148.json"
    stops = json.loads(fixture.read_text())["payload"]["stops"]
    assert ns.parse_train_origin(stops) == "Nijmegen"
    assert ns.parse_train_origin([]) is None
    assert ns.parse_train_origin([{"stop": {}}]) is None


def test_parse_trip_reads_the_train_destination_from_direction() -> None:
    leg = {**TRIP_ITEM["legs"][0], "direction": "Den Haag Centraal"}
    trip = ns.parse_trip({**TRIP_ITEM, "legs": [leg]})
    assert trip is not None
    assert trip.train_destination == "Den Haag Centraal"
    trip = ns.parse_trip(TRIP_ITEM)
    assert trip is not None
    assert trip.train_destination is None


def test_fetch_trips_reads_the_train_origin_from_the_journey(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = {"id": "A", "stop": {"name": "Nijmegen", "uicCode": "8400470"}}
    trips_with_journey(monkeypatch, journey(first, stop("8400621", actualStock=stock(620))))
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.train_origin == "Nijmegen"
    assert trip.seats == 620


def test_failed_journey_leaves_the_train_origin_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    trips_with_journey(monkeypatch, ns.NsError("boom"))
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.train_origin is None


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
        if path != "v3/trips":
            return {}
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
