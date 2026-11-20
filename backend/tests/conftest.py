import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from tests.factories import UserFactory


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
