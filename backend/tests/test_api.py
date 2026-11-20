from pathlib import Path

import pytest
from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework.test import APIClient

from tests.factories import UserFactory


@override_settings(SENTRY_DSN="https://key@sentry.example/1", GIT_SHA="abc123")
def test_client_config_is_public(client_api: APIClient) -> None:
    response = client_api.get("/api/config/")
    assert response.status_code == 200
    assert response.json() == {
        "sentry_dsn": "https://key@sentry.example/1",
        "environment": "production",
        "release": "abc123",
        "google_login": False,
    }


def test_me_logged_out_sets_csrf_cookie(client_api: APIClient) -> None:
    response = client_api.get("/api/auth/me/")
    assert response.status_code == 204
    assert "csrftoken" in response.cookies


def test_login_and_logout(client_api: APIClient, user: User) -> None:
    response = client_api.post(
        "/api/auth/login/", {"email": user.username, "password": "secret-password"}
    )
    assert response.status_code == 200
    assert response.json() == {"id": user.id, "username": user.username}
    assert client_api.get("/api/auth/me/").json()["username"] == user.username

    assert client_api.post("/api/auth/logout/").status_code == 204
    assert client_api.get("/api/auth/me/").status_code == 204


def test_login_wrong_password(client_api: APIClient, user: User) -> None:
    response = client_api.post("/api/auth/login/", {"email": user.username, "password": "x"})
    assert response.status_code == 400


def test_login_with_email_address(client_api: APIClient, db: None) -> None:
    account = UserFactory.create(username="someone", email="Someone@Example.com")
    response = client_api.post(
        "/api/auth/login/", {"email": "someone@example.com", "password": "secret-password"}
    )
    assert response.status_code == 200
    assert response.json()["id"] == account.id


def test_register_creates_account_and_logs_in(client_api: APIClient, db: None) -> None:
    response = client_api.post(
        "/api/auth/register/", {"email": "New@Example.com", "password": "a-good-passphrase-42"}
    )
    assert response.status_code == 201
    assert response.json()["username"] == "new@example.com"
    created = User.objects.get(email="new@example.com")
    assert created.check_password("a-good-passphrase-42")
    assert client_api.get("/api/auth/me/").json()["id"] == created.id

    client_api.post("/api/auth/logout/")
    login = client_api.post(
        "/api/auth/login/", {"email": "new@example.com", "password": "a-good-passphrase-42"}
    )
    assert login.status_code == 200


def test_register_rejects_duplicate_email(client_api: APIClient, db: None) -> None:
    UserFactory.create(username="taken@example.com", email="taken@example.com")
    response = client_api.post(
        "/api/auth/register/", {"email": "TAKEN@example.com", "password": "a-good-passphrase-42"}
    )
    assert response.status_code == 400
    assert "email" in response.json()
    assert User.objects.count() == 1


@pytest.mark.parametrize(
    ("email", "password", "field"),
    [
        ("not-an-email", "a-good-passphrase-42", "email"),
        ("a@example.com", "short", "password"),
        ("a@example.com", "password", "password"),
    ],
)
def test_register_validates_input(
    client_api: APIClient, db: None, email: str, password: str, field: str
) -> None:
    response = client_api.post("/api/auth/register/", {"email": email, "password": password})
    assert response.status_code == 400
    assert field in response.json()
    assert not User.objects.exists()


@pytest.mark.django_db
def test_schema_is_served(client_api: APIClient) -> None:
    assert client_api.get("/api/schema/").status_code == 200


@pytest.mark.django_db
def test_spa_fallback_serves_index(client_api: APIClient, tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<app-root></app-root>")
    with override_settings(FRONTEND_DIST=tmp_path):
        response = client_api.get("/commutes/1")
    assert response.status_code == 200
    assert b"<app-root>" in b"".join(response.streaming_content)  # type: ignore[attr-defined]  # FileResponse streams


@pytest.mark.django_db
def test_spa_fallback_without_build_is_404(client_api: APIClient, tmp_path: Path) -> None:
    with override_settings(FRONTEND_DIST=tmp_path):
        assert client_api.get("/commutes/1").status_code == 404
