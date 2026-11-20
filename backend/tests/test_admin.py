from collections.abc import Iterator

import pytest
from django.conf import settings
from django.test import Client, override_settings

from tests.factories import CommuteFactory, UserFactory


@pytest.fixture(autouse=True)
def plain_staticfiles() -> Iterator[None]:
    # The manifest storage needs collectstatic, which tests do not run.
    storages = {
        **settings.STORAGES,
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
    with override_settings(STORAGES=storages):
        yield


def test_admin_redirects_anonymous_to_login(db: None, client: Client) -> None:
    assert client.get("/admin/").status_code == 302


def test_commute_admin_changelist(db: None, client: Client) -> None:
    client.force_login(UserFactory.create(is_staff=True, is_superuser=True))
    CommuteFactory.create(name="To work")
    response = client.get("/admin/api/commute/")
    assert response.status_code == 200
    assert b"To work" in response.content
