"""The HTTP side of the NS API: base URL, subscription key, timeout and errors."""

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from django.conf import settings

BASE_URL = "https://gateway.apiportal.ns.nl/reisinformatie-api/api"
KEY_HEADER = "Ocp-Apim-Subscription-Key"
TIMEOUT_SECONDS = 10


class NsError(Exception):
    """The NS API could not be reached or returned something unusable."""


class NsNotConfigured(NsError):
    """NS_API_KEY is not set."""


def get_json(url: str, params: dict[str, str] | None = None) -> Any:
    """GET a URL on the NS API gateway with our subscription key; any NS API uses this."""
    if not settings.NS_API_KEY:
        raise NsNotConfigured("NS_API_KEY is not set.")
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={KEY_HEADER: settings.NS_API_KEY})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise NsError(f"NS API request to {url} failed: {error}") from error


def get(path: str, params: dict[str, str] | None = None) -> Any:
    """GET a path of the Reisinformatie API."""
    return get_json(f"{BASE_URL}/{path}", params)
