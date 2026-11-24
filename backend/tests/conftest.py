from pathlib import Path

import pytest
from django.conf import LazySettings
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APIClient

from tests.factories import UserFactory


@pytest.fixture(autouse=True)
def clear_cache(settings: LazySettings, tmp_path: Path) -> None:
    """NS results are cached per search, so one test's cache must not serve the next.

    Each test gets its own cache directory, so tests never touch a dev server's cache.
    """
    settings.CACHES = {"default": {**settings.CACHES["default"], "LOCATION": str(tmp_path / "c")}}
    cache.clear()


@pytest.fixture
def user(db: None) -> User:
    return UserFactory.create()


@pytest.fixture
def client_api() -> APIClient:
    return APIClient()


@pytest.fixture
def logged_in(client_api: APIClient, user: User) -> APIClient:
    client_api.force_authenticate(user)
    return client_api
