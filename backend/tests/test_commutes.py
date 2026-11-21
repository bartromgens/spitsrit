import pytest
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient

from api import ns
from api.models import Commute
from tests.factories import CommuteFactory, UserFactory
from tests.test_ns import make_trip


@pytest.mark.django_db
def test_commutes_require_login(client_api: APIClient) -> None:
    assert client_api.get("/api/commutes/").status_code == 403


def test_commute_crud(logged_in: APIClient, user: User) -> None:
    payload = {
        "name": "To work",
        "origin_code": "UT",
        "origin_name": "Utrecht Centraal",
        "destination_code": "ASD",
        "destination_name": "Amsterdam Centraal",
        "usual_departure_time": "08:05:00",
    }
    created = logged_in.post("/api/commutes/", payload)
    assert created.status_code == 201
    commute_id = created.json()["id"]
    assert Commute.objects.get(id=commute_id).user == user

    listed = logged_in.get("/api/commutes/").json()
    assert [c["name"] for c in listed["results"]] == ["To work"]

    updated = logged_in.patch(f"/api/commutes/{commute_id}/", {"name": "Morning"})
    assert updated.json()["name"] == "Morning"

    assert logged_in.delete(f"/api/commutes/{commute_id}/").status_code == 204
    assert not Commute.objects.exists()


def test_commute_origin_and_destination_must_differ(logged_in: APIClient) -> None:
    response = logged_in.post(
        "/api/commutes/",
        {
            "name": "Nowhere",
            "origin_code": "UT",
            "origin_name": "Utrecht Centraal",
            "destination_code": "UT",
            "destination_name": "Utrecht Centraal",
        },
    )
    assert response.status_code == 400


def test_commute_update_cannot_make_endpoints_equal(logged_in: APIClient, user: User) -> None:
    commute = CommuteFactory.create(user=user)
    response = logged_in.patch(f"/api/commutes/{commute.id}/", {"destination_code": "UT"})
    assert response.status_code == 400


def test_users_only_see_their_own_commutes(logged_in: APIClient, user: User) -> None:
    mine = CommuteFactory.create(user=user)
    theirs = CommuteFactory.create(user=UserFactory.create())
    ids = [c["id"] for c in logged_in.get("/api/commutes/").json()["results"]]
    assert ids == [mine.id]
    assert logged_in.get(f"/api/commutes/{theirs.id}/").status_code == 404
    assert logged_in.get(f"/api/commutes/{theirs.id}/trips/").status_code == 404
    assert logged_in.delete(f"/api/commutes/{theirs.id}/").status_code == 404


def test_commute_str() -> None:
    assert str(Commute(name="To work")) == "To work"


def test_trips_returns_trips_and_advice(
    logged_in: APIClient, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    commute = CommuteFactory.create(user=user)
    seen: list[tuple[str, str]] = []

    def fake_fetch(
        origin: str, destination: str, when: object, *filters: int | None
    ) -> list[ns.Trip]:
        seen.append((origin, destination))
        base = timezone.now()
        return [
            make_trip("slow", 1, duration=50, base=base),
            make_trip("fast", 12, duration=30, base=base),
        ]

    monkeypatch.setattr(ns, "fetch_trips", fake_fetch)
    response = logged_in.get(f"/api/commutes/{commute.id}/trips/")
    assert response.status_code == 200
    body = response.json()
    assert seen == [("UT", "ASD")]
    assert [t["uid"] for t in body["trips"]] == ["slow", "fast"]
    assert body["recommended_uid"] == "fast"
    assert 10 <= body["wait_minutes"] <= 12
    assert body["trips"][0]["departure_track"] == "5"


@pytest.mark.parametrize(
    ("error", "expected"),
    [(ns.NsNotConfigured("no key"), 503), (ns.NsError("boom"), 502)],
)
def test_trips_ns_failures(
    logged_in: APIClient,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    error: ns.NsError,
    expected: int,
) -> None:
    commute = CommuteFactory.create(user=user)

    def fail(*args: object) -> list[ns.Trip]:
        raise error

    monkeypatch.setattr(ns, "fetch_trips", fail)
    assert logged_in.get(f"/api/commutes/{commute.id}/trips/").status_code == expected


def test_stations_search(logged_in: APIClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ns, "fetch_stations", lambda: [ns.Station("UT", "Utrecht Centraal")])
    response = logged_in.get("/api/stations/?q=utr")
    assert response.status_code == 200
    assert response.json() == [{"code": "UT", "name": "Utrecht Centraal"}]


def test_stations_without_key(logged_in: APIClient) -> None:
    assert logged_in.get("/api/stations/?q=utr").status_code == 503


def test_stations_ns_down(logged_in: APIClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def fail() -> list[ns.Station]:
        raise ns.NsError("boom")

    monkeypatch.setattr(ns, "fetch_stations", fail)
    assert logged_in.get("/api/stations/?q=utr").status_code == 502


def test_plan_trip_and_stations_are_public(
    client_api: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ns, "fetch_stations", lambda: [ns.Station("UT", "Utrecht Centraal")])
    monkeypatch.setattr(
        ns, "fetch_trips", lambda *args: [make_trip("only", 5, base=timezone.now())]
    )
    assert client_api.get("/api/stations/?q=utr").status_code == 200
    assert client_api.get("/api/trips/?from=UT&to=ASD").status_code == 200


def test_plan_trip_returns_trips_and_advice(
    logged_in: APIClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[str, str]] = []

    def fake_fetch(
        origin: str, destination: str, when: object, *filters: int | None
    ) -> list[ns.Trip]:
        seen.append((origin, destination))
        return [make_trip("only", 5, base=timezone.now())]

    monkeypatch.setattr(ns, "fetch_trips", fake_fetch)
    response = logged_in.get("/api/trips/?from=UT&to=ASD")
    assert response.status_code == 200
    assert seen == [("UT", "ASD")]
    assert response.json()["recommended_uid"] == "only"


@pytest.mark.parametrize("query", ["", "?from=UT", "?to=ASD", "?from=UT&to=UT"])
def test_plan_trip_validates_stations(logged_in: APIClient, query: str) -> None:
    assert logged_in.get(f"/api/trips/{query}").status_code == 400


@pytest.mark.parametrize(
    ("error", "expected"),
    [(ns.NsNotConfigured("no key"), 503), (ns.NsError("boom"), 502)],
)
def test_plan_trip_ns_failures(
    logged_in: APIClient, monkeypatch: pytest.MonkeyPatch, error: ns.NsError, expected: int
) -> None:
    def fail(*args: object) -> list[ns.Trip]:
        raise error

    monkeypatch.setattr(ns, "fetch_trips", fail)
    assert logged_in.get("/api/trips/?from=UT&to=ASD").status_code == expected
