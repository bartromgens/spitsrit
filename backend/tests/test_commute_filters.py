from dataclasses import replace

import pytest
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient

from api import ns
from tests.factories import CommuteFactory
from tests.test_ns import make_trip


def test_filters_default_to_none_and_can_be_saved_and_cleared(
    logged_in: APIClient, user: User
) -> None:
    commute = CommuteFactory.create(user=user)
    first = logged_in.get(f"/api/commutes/{commute.id}/").json()
    assert first["max_duration_minutes"] is None
    assert first["max_transfers"] is None

    saved = logged_in.patch(
        f"/api/commutes/{commute.id}/",
        {"max_duration_minutes": 45, "max_transfers": 1},
        format="json",
    )
    assert saved.status_code == 200
    commute.refresh_from_db()
    assert (commute.max_duration_minutes, commute.max_transfers) == (45, 1)

    cleared = logged_in.patch(
        f"/api/commutes/{commute.id}/", {"max_duration_minutes": None}, format="json"
    )
    assert cleared.json()["max_duration_minutes"] is None
    assert cleared.json()["max_transfers"] == 1


def test_filters_reject_negative_values(logged_in: APIClient, user: User) -> None:
    commute = CommuteFactory.create(user=user)
    response = logged_in.patch(f"/api/commutes/{commute.id}/", {"max_transfers": -1})
    assert response.status_code == 400


def test_trips_apply_saved_filters(
    logged_in: APIClient, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    commute = CommuteFactory.create(user=user, max_duration_minutes=40, max_transfers=0)
    base = timezone.now()
    all_trips = [
        make_trip("fast", 12, duration=30, base=base),
        make_trip("long", 5, duration=50, base=base),
        replace(make_trip("transfer", 8, duration=35, base=base), transfers=1),
    ]
    monkeypatch.setattr(ns, "fetch_trips", lambda *args: all_trips)

    body = logged_in.get(f"/api/commutes/{commute.id}/trips/").json()
    assert [t["uid"] for t in body["trips"]] == ["fast"]
    assert body["recommended_uid"] == "fast"

    commute.max_duration_minutes = None
    commute.max_transfers = None
    commute.save()
    body = logged_in.get(f"/api/commutes/{commute.id}/trips/").json()
    assert [t["uid"] for t in body["trips"]] == ["fast", "long", "transfer"]


def test_trips_filters_can_leave_nothing(
    logged_in: APIClient, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    commute = CommuteFactory.create(user=user, max_duration_minutes=10)
    monkeypatch.setattr(
        ns, "fetch_trips", lambda *args: [make_trip("a", 5, duration=30, base=timezone.now())]
    )
    body = logged_in.get(f"/api/commutes/{commute.id}/trips/").json()
    assert body["trips"] == []
    assert body["recommended_uid"] is None
