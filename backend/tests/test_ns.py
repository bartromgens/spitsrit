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


def test_parse_boarding_stock_reads_the_units_and_facilities() -> None:
    fixture = Path(__file__).parent / "fixtures" / "ns_journey_3148.json"
    stops = json.loads(fixture.read_text())["payload"]["stops"]
    stock = ns.parse_boarding_stock(stops, "8400621")
    assert stock is not None
    assert stock.parts == (
        ns.TrainPart(
            "9469",
            ("WIFI", "TOILET", "STILTE", "FIETS", "STROOM"),
            "https://vt.ns-mlab.nl/v1/images/virmm1_4.png",
        ),
        ns.TrainPart(
            "9596",
            ("WIFI", "TOILET", "STILTE", "FIETS"),
            "https://vt.ns-mlab.nl/v1/images/virm_4.png",
        ),
    )


@pytest.mark.parametrize(
    "image",
    [None, {}, {"uri": ""}, {"uri": "http://vt.ns-mlab.nl/a.png"}, {"uri": "javascript:x"}, "x"],
)
def test_train_part_without_a_usable_image(image: Any) -> None:
    [part] = ns._train_parts([{"stockIdentifier": "1", "facilities": [], "image": image}])
    assert part.image_url is None


def test_fetch_trips_passes_the_boarding_units_on(monkeypatch: pytest.MonkeyPatch) -> None:
    boarding = {**stock(620), "trainParts": [{"stockIdentifier": "9401", "facilities": ["WIFI"]}]}
    trips_with_journey(monkeypatch, journey(stop("8400621", actualStock=boarding)))
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.train_parts == (ns.TrainPart("9401", ("WIFI",)),)


DETAILED_LEG: dict[str, Any] = {
    "travelType": "PUBLIC_TRANSIT",
    "direction": "Den Haag Centraal",
    "cancelled": False,
    "crowdForecast": "HIGH",
    "punctuality": 87.5,
    "origin": {
        "name": "Utrecht Centraal",
        "plannedDateTime": "2026-11-20T08:00:00+0100",
        "actualDateTime": "2026-11-20T08:02:00+0100",
        "plannedTrack": "5",
        "actualTrack": "7",
    },
    "destination": {
        "name": "Gouda",
        "plannedDateTime": "2026-11-20T08:18:00+0100",
        "plannedTrack": "3",
        "actualTrack": "3",
        "exitSide": "RIGHT",
    },
    "product": {
        "shortCategoryName": "IC",
        "number": "2136",
        "longCategoryName": "Intercity",
        "operatorName": "NS",
        "notes": [[{"value": "Stiltecoupé"}, {"value": "Toegankelijk"}]],
    },
    "stops": [
        {
            "name": "Utrecht Centraal",
            "plannedDepartureDateTime": "2026-11-20T08:00:00+0100",
            "actualDepartureDateTime": "2026-11-20T08:02:00+0100",
            "plannedDepartureTrack": "5",
            "actualDepartureTrack": "7",
        },
        {"name": "Woerden", "passing": True},
        {
            "name": "Gouda",
            "plannedArrivalDateTime": "2026-11-20T08:18:00+0100",
            "plannedArrivalTrack": "3",
        },
    ],
    "notes": [{"value": "Reserveren niet nodig"}],
    "messages": [{"head": "Werkzaamheden", "text": "Minder treinen"}, {"text": ""}],
    "transferMessages": [{"message": "Overstap op hetzelfde perron"}],
    "shorterStockWarning": "Kortere trein",
}


def test_parse_trip_reads_every_leg_in_detail() -> None:
    item = {**TRIP_ITEM, "punctuality": 90, "messages": [{"head": "Storing"}]}
    walk = {
        "travelType": "WALK",
        "name": "Lopen",
        "destination": {"plannedDateTime": "2026-11-20T08:25:00+0100"},
    }
    trip = ns.parse_trip({**item, "legs": [DETAILED_LEG, walk]})
    assert trip is not None
    assert trip.punctuality == 90.0
    assert trip.messages == ("Storing",)
    leg, walk_leg = trip.legs
    assert (leg.name, leg.category, leg.operator) == ("IC 2136", "Intercity", "NS")
    assert (leg.direction, leg.origin, leg.destination) == (
        "Den Haag Centraal",
        "Utrecht Centraal",
        "Gouda",
    )
    assert (leg.departure_track, leg.departure_track_changed) == ("7", True)
    assert (leg.arrival_track, leg.arrival_track_changed) == ("3", False)
    assert leg.arrival_actual is None
    assert leg.exit_side == "RIGHT"
    assert (leg.crowd_forecast, leg.punctuality) == ("HIGH", 87.5)
    assert leg.notes == ("Reserveren niet nodig", "Stiltecoupé", "Toegankelijk")
    assert leg.messages == ("Werkzaamheden - Minder treinen",)
    assert leg.transfer_messages == ("Overstap op hetzelfde perron",)
    assert leg.shorter_stock_warning == "Kortere trein"
    first, passed, last = leg.stops
    assert (first.track, first.track_changed, first.departure_actual) == (
        "7",
        True,
        datetime.fromisoformat("2026-11-20T08:02:00+01:00"),
    )
    assert passed.passing and passed.track is None
    assert (last.track, last.departure_planned) == ("3", None)
    assert (walk_leg.travel_type, walk_leg.name, walk_leg.stops) == ("WALK", "Lopen", ())


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
            {"code": "UT", "namen": {"lang": "Utrecht Centraal"}, "stationType": "MEGA_STATION"},
            {"code": "UTM", "namen": {"lang": "Utrecht Maliebaan"}, "stationType": "NEW_TYPE"},
            {"code": "XX"},
            {"namen": {"lang": "Nameless"}},
        ]
    }
    stations = ns.parse_stations(payload)
    assert stations == [
        ns.Station("UT", "Utrecht Centraal"),
        ns.Station("UTM", "Utrecht Maliebaan"),
    ]
    assert [s.rank for s in stations] == [0, len(ns.STATION_TYPES)]


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


def test_search_stations_puts_big_stations_first(monkeypatch: pytest.MonkeyPatch) -> None:
    rank = ns.STATION_TYPES.index
    stations = [
        ns.Station("UTVR", "Utrecht Vaartsche Rijn", rank("KNOOPPUNT_STOPTREIN_STATION")),
        ns.Station("UTLR", "Utrecht Leidsche Rijn", rank("STOPTREIN_STATION")),
        ns.Station("UTO", "Utrecht Overvecht", rank("KNOOPPUNT_STOPTREIN_STATION")),
        ns.Station("UT", "Utrecht Centraal", rank("MEGA_STATION")),
        ns.Station("DUT", "Duitsland-Utrecht", rank("MEGA_STATION")),
    ]
    monkeypatch.setattr(ns, "fetch_stations", lambda: stations)
    names = [s.name for s in ns.search_stations("Utrecht")]
    assert names == [
        "Utrecht Centraal",
        "Utrecht Overvecht",
        "Utrecht Vaartsche Rijn",
        "Utrecht Leidsche Rijn",
        "Duitsland-Utrecht",
    ]


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
        items = [page_item(f"t{i}", i) for i in range(20)]
        return {"trips": [*items, {"legs": []}]}

    monkeypatch.setattr(ns, "_get", fake_get)
    trips = ns.fetch_trips("UT", "ASD", NOW)
    assert len(trips) == ns.MAX_TRIPS
    assert seen["path"] == "v3/trips"
    assert seen["params"]["fromStation"] == "UT"
    assert seen["params"]["toStation"] == "ASD"


def page_item(uid: str, leaves_in: int, duration: int = 30, transfers: int = 0) -> dict[str, Any]:
    """A raw trip item leaving `leaves_in` minutes after NOW."""
    departure = NOW + timedelta(minutes=leaves_in)
    arrival = departure + timedelta(minutes=duration)
    return {
        "uid": uid,
        "transfers": transfers,
        "legs": [
            {
                "travelType": "WALK",
                "origin": {"plannedDateTime": departure.isoformat()},
                "destination": {"plannedDateTime": arrival.isoformat()},
            }
        ],
    }


def serve_pages(
    monkeypatch: pytest.MonkeyPatch, pages: list[list[dict[str, Any]]]
) -> list[dict[str, str] | None]:
    """Serve `pages` one per trips request, each pointing at the next; returns the params seen."""
    calls: list[dict[str, str] | None] = []

    def fake_get(path: str, params: dict[str, str] | None = None) -> Any:
        calls.append(params)
        index = len(calls) - 1
        page = pages[min(index, len(pages) - 1)]
        payload: dict[str, Any] = {"trips": page}
        if index < len(pages) - 1:
            payload["scrollRequestForwardContext"] = f"ctx{index + 1}"
        return payload

    monkeypatch.setattr(ns, "_get", fake_get)
    return calls


def test_fetch_trips_requests_the_next_page_until_an_hour_is_covered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = serve_pages(
        monkeypatch,
        [
            [page_item("a", 5), page_item("b", 25)],
            [page_item("c", 45), page_item("d", 65)],
            [page_item("e", 85)],
        ],
    )
    trips = ns.fetch_trips("UT", "ASD", NOW)
    assert [t.uid for t in trips] == ["a", "b", "c", "d"]
    assert len(calls) == 2
    assert calls[0] is not None and "context" not in calls[0]
    assert calls[1] is not None and calls[1]["context"] == "ctx1"


def test_fetch_trips_makes_at_most_three_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = serve_pages(
        monkeypatch,
        [[page_item("a", 5)], [page_item("b", 10)], [page_item("c", 15)], [page_item("d", 20)]],
    )
    trips = ns.fetch_trips("UT", "ASD", NOW)
    assert len(calls) == ns.MAX_TRIP_REQUESTS == 3
    assert [t.uid for t in trips] == ["a", "b", "c"]


def test_fetch_trips_stops_without_forward_context(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = serve_pages(monkeypatch, [[page_item("a", 5)]])
    assert [t.uid for t in ns.fetch_trips("UT", "ASD", NOW)] == ["a"]
    assert len(calls) == 1


def test_fetch_trips_stops_when_a_page_adds_nothing_new(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = serve_pages(
        monkeypatch, [[page_item("a", 5)], [page_item("a", 5)], [page_item("b", 9)]]
    )
    assert [t.uid for t in ns.fetch_trips("UT", "ASD", NOW)] == ["a"]
    assert len(calls) == 2


def test_fetch_trips_lists_duplicates_across_pages_once(monkeypatch: pytest.MonkeyPatch) -> None:
    serve_pages(
        monkeypatch,
        [[page_item("a", 5), page_item("b", 20)], [page_item("b", 20), page_item("c", 70)]],
    )
    assert [t.uid for t in ns.fetch_trips("UT", "ASD", NOW)] == ["a", "b", "c"]


def test_fetch_trips_filters_before_checking_the_hour(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = serve_pages(
        monkeypatch,
        [
            [page_item("slow", 5, duration=90), page_item("far", 70, duration=90)],
            [page_item("hop", 40, transfers=3), page_item("ok", 50, duration=30)],
            [page_item("late", 80, duration=30)],
        ],
    )
    trips = ns.fetch_trips("UT", "ASD", NOW, max_duration_minutes=40, max_transfers=1)
    assert [t.uid for t in trips] == ["ok", "late"]
    assert len(calls) == 3


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


def test_parse_leg_reads_station_codes() -> None:
    leg = ns.parse_leg(
        {
            **DETAILED_LEG,
            "origin": {**DETAILED_LEG["origin"], "stationCode": "UT"},
            "destination": {**DETAILED_LEG["destination"], "stationCode": "GD"},
        }
    )
    assert (leg.origin_code, leg.destination_code) == ("UT", "GD")


def test_parse_leg_without_station_codes() -> None:
    leg = ns.parse_leg(DETAILED_LEG)
    assert (leg.origin_code, leg.destination_code) == (None, None)


def test_parse_leg_reads_bicycle_spots() -> None:
    assert ns.parse_leg({**DETAILED_LEG, "bicycleSpotCount": 6}).bicycle_spots == 6
    assert ns.parse_leg({**DETAILED_LEG, "bicycleSpotCount": 0}).bicycle_spots is None
    for missing in (None, -1, True, "6"):
        assert ns.parse_leg({**DETAILED_LEG, "bicycleSpotCount": missing}).bicycle_spots is None


def journey_stop(
    stop_id: str, uic: str, name: str, after: list[str], status: str = "STOP", **extra: Any
) -> dict[str, Any]:
    return {
        "id": stop_id,
        "stop": {"uicCode": uic, "name": name},
        "nextStopId": after,
        "status": status,
        **extra,
    }


REAL_SPLIT = Path(__file__).parent / "fixtures" / "ns_journey_3070_split.json"


def test_parse_split_from_a_real_journey_where_a_unit_stays_behind() -> None:
    # IC 3070 Nijmegen → Den Helder: unit 9404 goes no further than Alkmaar (8400050).
    # NS marks no SPLIT stop; only the units' destinations and a note say so.
    stops = json.loads(REAL_SPLIT.read_text())["payload"]["stops"]
    assert ns.parse_split(stops, "8400621", "8400058") == ns.SplitInfo(("Alkmaar",), None)
    # Past Alkmaar only the Den Helder part gets there: Den Helder (8400311).
    assert ns.parse_split(stops, "8400621", "8400311") == ns.SplitInfo(("Alkmaar",), "Den Helder")
    # Boarding at Alkmaar (found by uicCode once `kind` is gone): one unit left, no split.
    unmarked = [{k: v for k, v in s.items() if k != "kind"} for s in stops]
    assert ns.parse_split(unmarked, "8400050", "8400311") == ns.SplitInfo()


def part_to(uic: str, name: str) -> dict[str, Any]:
    return {"stockIdentifier": uic, "destination": {"uicCode": uic, "name": name}}


def test_parse_split_needs_a_boarding_stop_and_known_destinations() -> None:
    stops = [
        journey_stop(
            "A",
            "1",
            "A",
            ["B"],
            kind="DEPARTURE",
            actualStock={
                "trainParts": [part_to("2", "B"), part_to("9", "Elsewhere"), {"destination": None}]
            },
        ),
        journey_stop("B", "2", "B", ["C"]),
        journey_stop("C", "3", "C", ["A"]),  # a cycle back to the start ends the walk
    ]
    assert ns.parse_split(stops, "1", "3") == ns.SplitInfo(("B",), None)
    assert ns.parse_split([], "1", "3") == ns.SplitInfo()


def test_parse_boarding_layout_reads_coaches_and_platform_features() -> None:
    boarding = journey_stop(
        "UT_0",
        "1",
        "Utrecht Centraal",
        [],
        kind="DEPARTURE",
        coachCrowdForecast=[
            {"classification": "LOW", "paddingLeft": 0, "width": 100},
            {"classification": "HIGH", "paddingLeft": 100, "width": 100},
            {"classification": "HIGH", "paddingLeft": None, "width": 100},
        ],
        platformFeatures=[
            {"type": "LIFT", "description": "Lift", "paddingLeft": 40, "width": 10},
            {"type": "STAIRS", "description": "Trap", "paddingLeft": 150, "width": 0},
        ],
    )
    coaches, platform = ns.parse_boarding_layout([boarding], "1")
    assert coaches == (ns.Span(0, 100, "LOW"), ns.Span(100, 100, "HIGH"))
    assert platform == (ns.Span(40, 10, "LIFT", "Lift"),)
    assert ns.parse_boarding_layout([], "1") == ((), ())


def test_fetch_trips_adds_split_and_layout_of_the_boarding_stop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    leg = {
        **TRIP_ITEM["legs"][0],
        "origin": {**TRIP_ITEM["legs"][0]["origin"], "uicCode": "1"},
        "destination": {**TRIP_ITEM["legs"][0]["destination"], "uicCode": "3"},
    }
    boarding = journey_stop(
        "A",
        "1",
        "A",
        ["B"],
        kind="DEPARTURE",
        actualStock={**stock(600), "trainParts": [part_to("2", "B"), part_to("3", "C")]},
        coachCrowdForecast=[{"classification": "LOW", "paddingLeft": 0, "width": 5}],
    )
    stops = [boarding, journey_stop("B", "2", "B", ["C"]), journey_stop("C", "3", "C", [])]
    trips_with_journey(monkeypatch, journey(*stops), {**TRIP_ITEM, "legs": [leg]})
    [trip] = ns.fetch_trips("A", "C", NOW)
    assert trip.split_stations == ("B",)
    assert trip.board_destination == "C"
    assert trip.coach_crowding == (ns.Span(0, 5, "LOW"),)


def test_train_parts_read_their_destination() -> None:
    parts = ns._train_parts(
        [
            {"stockIdentifier": "1", "destination": {"name": "Zwolle"}},
            {"stockIdentifier": "2", "destination": {"namen": {"lang": "Enschede"}}},
            {"stockIdentifier": "3", "destination": "nope"},
        ]
    )
    assert [p.destination for p in parts] == ["Zwolle", "Enschede", None]


def test_fetch_trips_by_arrival_asks_ns_for_arrival_and_keeps_trips_arriving_in_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 30 minutes long: the trip leaving in 40 minutes arrives after NOW + 60.
    calls = serve_pages(
        monkeypatch, [[page_item("late", 40), page_item("b", 25), page_item("a", 5)]]
    )
    arrival = NOW + timedelta(minutes=60)
    trips = ns.fetch_trips("UT", "ASD", arrival, arrive=True)
    assert [t.uid for t in trips] == ["a", "b"]
    assert calls[0] is not None
    assert calls[0]["searchForArrival"] == "true"
    assert calls[0]["dateTime"] == arrival.isoformat()
    assert len(calls) == 1


def test_fetch_trips_by_default_does_not_search_for_arrival(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = serve_pages(monkeypatch, [[page_item("a", 5)]])
    ns.fetch_trips("UT", "ASD", NOW)
    assert calls[0] is not None
    assert "searchForArrival" not in calls[0]


def test_advise_by_arrival_picks_the_latest_departure() -> None:
    early = make_trip("early", 5, duration=20)
    late = make_trip("late", 15, duration=40)
    assert ns.advise([early, late], NOW, arrive=True) == ns.Advice("late", 15)
