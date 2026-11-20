from unittest import mock

import pytest
from django.db import connection
from django.test import Client, override_settings


@pytest.mark.django_db
@override_settings(GIT_SHA="abc123", ALLOWED_HOSTS=["example.com"])
def test_healthz_ok_ignores_allowed_hosts(client: Client) -> None:
    response = client.get("/healthz", HTTP_HOST="spitsrit-web-1")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "abc123", "db": "ok"}


def test_healthz_database_down(client: Client) -> None:
    with mock.patch.object(connection, "ensure_connection", side_effect=Exception("down")):
        response = client.get("/healthz")
    assert response.status_code == 503
    assert response.json()["db"] == "error"
