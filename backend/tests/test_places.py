import json
from pathlib import Path
from typing import Any

import pytest
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from api import ns, places

FIXTURE = Path(__file__).parent / "fixtures" / "ns_ovfiets_ut.json"


def location(rental_bikes: Any = "5", open_: Any = "Yes", **extra: Any) -> dict[str, Any]:
    return {
        "name": "UT - OV-fiets - Utrecht Centraal Knoop",
        "description": "Utrecht Centraal Knoop",
        "open": open_,
        "extra": {"rentalBikes": rental_bikes, "type": "OV_FIETS", **extra},
    }


def payload(*locations: dict[str, Any]) -> dict[str, Any]:
    return {"payload": [{"name": "OV-fiets", "locations": list(locations)}]}


def test_parse_ov_fiets_reads_a_real_response() -> None:
    parsed = places.parse_ov_fiets(json.loads(FIXTURE.read_text()))
    assert parsed == (
        places.OvFietsLocation("Utrecht Centraal Jaarbeursplein", 10, "Yes"),
        places.OvFietsLocation("Utrecht Centraal Stationsplein", 10, "Yes"),
        places.OvFietsLocation("Utrecht Centraal Knoop", 33, "Yes"),
    )
    assert places.OvFiets("UT", parsed).available == 53


@pytest.mark.parametrize("value", [None, "", "veel", "-1", 3.5])
def test_unreadable_counts_are_unknown(value: Any) -> None:
    (parsed,) = places.parse_ov_fiets(payload(location(rental_bikes=value)))
    assert parsed.available is None


def test_open_is_yes_no_or_unknown() -> None:
    parsed = places.parse_ov_fiets(
        payload(location(open_="No"), location(open_=None), location(open_="Maybe"))
    )
    assert [p.open for p in parsed] == ["No", "Unknown", "Unknown"]


def test_names_are_trimmed() -> None:
    # Real ASD response: "Amsterdam Centraal Stationsplein " ends in a space.
    item = {**location(), "description": "Amsterdam Centraal Stationsplein "}
    (parsed,) = places.parse_ov_fiets(payload(item))
    assert parsed.name == "Amsterdam Centraal Stationsplein"


def test_name_falls_back_to_the_location_name() -> None:
    item = {**location(), "description": None}
    (parsed,) = places.parse_ov_fiets(payload(item))
    assert parsed.name == "UT - OV-fiets - Utrecht Centraal Knoop"


@pytest.mark.parametrize(
    "body",
    [None, {}, {"payload": None}, {"payload": ["x"]}, {"payload": [{"locations": [1]}]}],
)
def test_malformed_responses_have_no_locations(body: Any) -> None:
    assert places.parse_ov_fiets(body) == ()


def test_total_counts_only_known_numbers() -> None:
    known = places.OvFietsLocation("A", 4, "Yes")
    unknown = places.OvFietsLocation("B", None, "Unknown")
    assert places.OvFiets("UT", (known, unknown)).available == 4
    assert places.OvFiets("UT", (unknown,)).available is None
    assert places.OvFiets("UT").available is None


def test_total_leaves_out_closed_rental_points() -> None:
    # Real LEDN response at night: the closed point still reports the bikes standing there.
    open_ = places.OvFietsLocation("Leiden Centraal,Uitgang LUMC", 6, "Yes")
    closed = places.OvFietsLocation("Leiden Centraal, Centrumzijde", 28, "No")
    assert places.OvFiets("LEDN", (open_, closed)).available == 6
    assert places.OvFiets("LEDN", (closed,)).available is None


def test_fetch_ov_fiets_asks_by_station_code_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    cache.clear()
    calls: list[tuple[str, dict[str, str] | None]] = []

    def fake_get(path: str, params: dict[str, str] | None = None) -> Any:
        calls.append((path, params))
        return payload(location("7"))

    monkeypatch.setattr(places, "_get", fake_get)
    first = places.fetch_ov_fiets("ut")
    second = places.fetch_ov_fiets("UT")
    assert first == second
    assert first.station_code == "UT"
    assert first.available == 7
    assert calls == [("v2/ovfiets", {"station_code": "UT"})]


def test_get_uses_the_places_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def fake_get_json(url: str, params: dict[str, str] | None = None) -> Any:
        seen.append(url)
        return {}

    monkeypatch.setattr(ns, "get_json", fake_get_json)
    places._get("v2/ovfiets")
    assert seen == ["https://gateway.apiportal.ns.nl/places-api/v2/ovfiets"]


def test_ov_fiets_endpoint_is_public(
    client_api: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    found = places.OvFiets(
        "ASD",
        (
            places.OvFietsLocation("Amsterdam Centraal IJzijde", 20, "Yes"),
            places.OvFietsLocation("Amsterdam Centraal Stationsplein", None, "No"),
        ),
    )
    monkeypatch.setattr(places, "fetch_ov_fiets", lambda code: found)
    response = client_api.get("/api/stations/ASD/ov-fiets/")
    assert response.status_code == 200
    assert response.json() == {
        "station_code": "ASD",
        "available": 20,
        "locations": [
            {"name": "Amsterdam Centraal IJzijde", "available": 20, "open": "Yes"},
            {"name": "Amsterdam Centraal Stationsplein", "available": None, "open": "No"},
        ],
    }


@override_settings(NS_API_KEY="")  # a local settings_local.py may set a real key
def test_ov_fiets_endpoint_without_key(client_api: APIClient) -> None:
    cache.clear()
    assert client_api.get("/api/stations/ASD/ov-fiets/").status_code == 503


def test_ov_fiets_endpoint_ns_down(client_api: APIClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(code: str) -> places.OvFiets:
        raise ns.NsError("down")

    monkeypatch.setattr(places, "fetch_ov_fiets", fail)
    assert client_api.get("/api/stations/ASD/ov-fiets/").status_code == 502
