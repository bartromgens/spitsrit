"""The `api.ns` package keeps its public names, and they come from the submodules."""

import pytest

from api import ns
from api.ns import advice, client, models, parse, stations, trips


@pytest.mark.parametrize(
    ("name", "module"),
    [
        ("NsError", client),
        ("NsNotConfigured", client),
        ("get_json", client),
        ("Trip", models),
        ("Station", models),
        ("parse_trip", parse),
        ("parse_stations", parse),
        ("fetch_trips", trips),
        ("fetch_stations", stations),
        ("search_stations", stations),
        ("advise", advice),
        ("Advice", advice),
    ],
)
def test_public_names_are_reexported(name: str, module: object) -> None:
    assert getattr(ns, name) is getattr(module, name)


def test_client_get_uses_the_reisinformatie_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[str, dict[str, str] | None]] = []

    def fake_get_json(url: str, params: dict[str, str] | None = None) -> dict[str, str]:
        seen.append((url, params))
        return {}

    monkeypatch.setattr(client, "get_json", fake_get_json)
    client.get("v2/stations", {"a": "b"})
    assert seen == [(f"{client.BASE_URL}/v2/stations", {"a": "b"})]


def test_get_json_needs_an_api_key(settings: object) -> None:
    settings.NS_API_KEY = ""  # type: ignore[attr-defined]  # pytest-django's settings fixture is untyped
    with pytest.raises(ns.NsNotConfigured):
        client.get_json("https://example.org")
