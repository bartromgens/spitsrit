import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework.test import APIClient

from api import google
from api.models import GoogleAccount
from tests.factories import UserFactory

PROFILE = google.GoogleProfile(sub="123", email="bart@example.com", name="Bart")
CONFIGURED = override_settings(GOOGLE_CLIENT_ID="id", GOOGLE_CLIENT_SECRET="secret")
LOGIN_ERROR = "/login?error=google"


def start(client: APIClient) -> str:
    response = client.get("/api/auth/google/")
    assert response.status_code == 302
    query = urllib.parse.urlparse(response["Location"]).query
    return urllib.parse.parse_qs(query)["state"][0]


def callback(client: APIClient, state: str, profile: google.GoogleProfile = PROFILE) -> str:
    with patch("api.google.fetch_profile", return_value=profile):
        return client.get("/api/auth/google/callback/", {"code": "c", "state": state})["Location"]


@CONFIGURED
@pytest.mark.django_db
def test_start_redirects_to_google(client_api: APIClient) -> None:
    response = client_api.get("/api/auth/google/")
    assert response.status_code == 302
    assert response["Location"].startswith(google.AUTH_URL)
    query = urllib.parse.parse_qs(urllib.parse.urlparse(response["Location"]).query)
    assert query["client_id"] == ["id"]
    assert query["redirect_uri"] == ["http://testserver/api/auth/google/callback/"]


@pytest.mark.django_db
def test_start_without_credentials_goes_back_to_login(client_api: APIClient) -> None:
    assert client_api.get("/api/auth/google/")["Location"] == LOGIN_ERROR


@CONFIGURED
@pytest.mark.django_db
def test_first_login_creates_an_account(client_api: APIClient) -> None:
    assert callback(client_api, start(client_api)) == "/commutes"
    user = User.objects.get(email="bart@example.com")
    assert user.username == "bart@example.com"
    assert not user.has_usable_password()
    assert user.google_account.sub == "123"
    assert client_api.get("/api/auth/me/").json()["username"] == "bart@example.com"


@CONFIGURED
@pytest.mark.django_db
def test_second_login_reuses_the_account(client_api: APIClient) -> None:
    callback(client_api, start(client_api))
    callback(client_api, start(client_api))
    assert User.objects.count() == 1
    assert GoogleAccount.objects.count() == 1


@CONFIGURED
@pytest.mark.django_db
def test_does_not_take_over_a_password_account_with_the_same_email(
    client_api: APIClient,
) -> None:
    existing = UserFactory.create(username="bart@example.com")
    callback(client_api, start(client_api))
    assert GoogleAccount.objects.get(sub="123").user != existing


@CONFIGURED
@pytest.mark.django_db
def test_wrong_state_is_rejected(client_api: APIClient) -> None:
    start(client_api)
    assert callback(client_api, "bad") == LOGIN_ERROR
    assert User.objects.count() == 0


@CONFIGURED
@pytest.mark.django_db
def test_callback_without_a_started_login_is_rejected(client_api: APIClient) -> None:
    assert callback(client_api, "x") == LOGIN_ERROR
    assert User.objects.count() == 0


@CONFIGURED
@pytest.mark.django_db
def test_state_cannot_be_reused(client_api: APIClient) -> None:
    state = start(client_api)
    callback(client_api, state)
    assert callback(client_api, state) == LOGIN_ERROR


@CONFIGURED
@pytest.mark.django_db
def test_google_failure_goes_back_to_login(client_api: APIClient) -> None:
    state = start(client_api)
    with patch("api.google.fetch_profile", side_effect=google.GoogleError("down")):
        response = client_api.get("/api/auth/google/callback/", {"code": "c", "state": state})
    assert response["Location"] == LOGIN_ERROR
    assert User.objects.count() == 0


@CONFIGURED
def test_fetch_profile_exchanges_the_code() -> None:
    calls: list[str] = []

    def fake_send(request: urllib.request.Request) -> dict[str, object]:
        calls.append(request.full_url)
        if request.full_url == google.TOKEN_URL:
            return {"access_token": "tok"}
        return {"sub": "9", "email": "a@b.nl", "email_verified": True, "name": "A"}

    with patch("api.google._send", side_effect=fake_send):
        profile = google.fetch_profile("code", "http://x/cb")
    assert profile == google.GoogleProfile(sub="9", email="a@b.nl", name="A")
    assert calls == [google.TOKEN_URL, google.USERINFO_URL]


@pytest.mark.parametrize(
    "responses",
    [
        [{}],
        [{"access_token": "t"}, {"email": "a@b.nl", "email_verified": True}],
        [{"access_token": "t"}, {"sub": "1", "email": "a@b.nl", "email_verified": False}],
        [{"access_token": "t"}, {"sub": "1", "email_verified": True}],
    ],
)
@CONFIGURED
def test_fetch_profile_rejects_unusable_answers(responses: list[dict[str, object]]) -> None:
    with patch("api.google._send", side_effect=responses), pytest.raises(google.GoogleError):
        google.fetch_profile("code", "http://x/cb")


def test_send_wraps_network_errors() -> None:
    with (
        patch("urllib.request.urlopen", side_effect=urllib.error.URLError("boom")),
        pytest.raises(google.GoogleError),
    ):
        google._send(urllib.request.Request("https://example.com"))


@CONFIGURED
@pytest.mark.django_db
def test_config_reports_google_login(client_api: APIClient) -> None:
    assert client_api.get("/api/config/").json()["google_login"] is True


@pytest.mark.django_db
def test_config_reports_google_login_off(client_api: APIClient) -> None:
    assert client_api.get("/api/config/").json()["google_login"] is False
