import json
from pathlib import Path
from typing import Any

import pytest
from django.core.cache import cache

from api import ns
from api.serializers import TripSerializer

from .test_ns import NOW

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_journey(name: str) -> dict[str, Any]:
    journey: dict[str, Any] = json.loads((FIXTURES / name).read_text())
    return journey


def train(ref: str, boarding: str, alighting: str, minute: int) -> dict[str, Any]:
    return {
        "travelType": "PUBLIC_TRANSIT",
        "journeyDetailRef": ref,
        "origin": {
            "uicCode": boarding,
            "plannedDateTime": f"2026-11-20T08:{minute:02d}:00+0100",
        },
        "destination": {
            "uicCode": alighting,
            "plannedDateTime": f"2026-11-20T09:{minute:02d}:00+0100",
        },
        "product": {"shortCategoryName": "IC", "number": ref},
    }


def walk() -> dict[str, Any]:
    return {
        "travelType": "WALK",
        "origin": {"plannedDateTime": "2026-11-20T08:50:00+0100"},
        "destination": {"plannedDateTime": "2026-11-20T08:55:00+0100"},
    }


def item(uid: str, *legs: dict[str, Any]) -> dict[str, Any]:
    return {"uid": uid, "transfers": len(legs) - 1, "status": "NORMAL", "legs": list(legs)}


# Leg 1 boards at Utrecht (740 seats), leg 2 at Arnhem Centraal (732 seats) of the real journeys.
LEG_ONE = train("A", "8400621", "8400282", 0)
LEG_TWO = train("B", "8400071", "8400200", 30)
JOURNEYS = {
    "A": fixture_journey("ns_journey_3148.json"),
    "B": fixture_journey("ns_journey_3070_split.json"),
}


def mock_ns(
    monkeypatch: pytest.MonkeyPatch,
    items: list[dict[str, Any]],
    failing: tuple[str, ...] = (),
) -> list[str]:
    """Mock NS: the trips `items`, and the real journeys by `id`. Returns the journey ids asked."""
    asked: list[str] = []

    def fake_get(path: str, params: dict[str, str] | None = None) -> Any:
        if path == "v3/trips":
            return {"trips": items}
        assert params is not None
        asked.append(params["id"])
        if params["id"] in failing:
            raise ns.NsError("boom")
        return JOURNEYS[params["id"]]

    cache.clear()
    monkeypatch.setattr(ns.client, "get", fake_get)
    return asked


def test_every_train_leg_gets_the_size_of_its_own_boarding_stop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_ns(monkeypatch, [item("t", LEG_ONE, walk(), LEG_TWO)])
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    one, middle, two = trip.legs
    assert (one.seats, one.carriages, one.train_type) == (740, 8, "VIRM")
    assert (two.seats, two.carriages) == (732, 8)
    assert two.train_parts
    assert (middle.seats, middle.train_parts) == (None, ())
    # The first leg's journey is the same as the trip-level fields.
    assert (trip.seats, trip.carriages, trip.train_type) == (740, 8, "VIRM")
    assert trip.train_parts == one.train_parts
    assert trip.min_seats == 732


def test_a_failed_lookup_leaves_only_that_leg_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_ns(monkeypatch, [item("t", LEG_ONE, LEG_TWO)], failing=("B",))
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    one, two = trip.legs
    assert one.seats == 740
    assert (two.seats, two.carriages, two.train_type, two.train_parts) == (None, None, None, ())
    assert trip.seats == 740
    assert trip.min_seats == 740


def test_a_failed_first_leg_keeps_the_second_and_the_trip_level_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_ns(monkeypatch, [item("t", LEG_ONE, LEG_TWO)], failing=("A",))
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.legs[0].seats is None
    assert trip.legs[1].seats == 732
    assert trip.seats is None
    assert trip.min_seats == 732


def test_the_same_journey_in_several_trips_is_fetched_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asked = mock_ns(
        monkeypatch,
        [item("t1", LEG_ONE, LEG_TWO), item("t2", LEG_ONE, LEG_TWO), item("t3", LEG_TWO)],
    )
    trips = ns.fetch_trips("UT", "ASD", NOW)
    assert sorted(asked) == ["A", "B"]
    assert [t.legs[-1].seats for t in trips] == [732, 732, 732]


def test_min_seats_is_null_when_no_size_is_known(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_ns(monkeypatch, [item("t", LEG_ONE, LEG_TWO)], failing=("A", "B"))
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    assert trip.min_seats is None
    assert TripSerializer(trip).data["min_seats"] is None


def test_the_serializer_shows_per_leg_and_trip_level_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_ns(monkeypatch, [item("t", LEG_ONE, LEG_TWO)])
    [trip] = ns.fetch_trips("UT", "ASD", NOW)
    data = TripSerializer(trip).data
    assert data["seats"] == 740
    assert data["min_seats"] == 732
    assert [leg["seats"] for leg in data["legs"]] == [740, 732]
    assert data["legs"][1]["carriages"] == 8
    assert "split_stations" in data["legs"][1]
