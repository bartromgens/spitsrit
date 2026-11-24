"""The HTTP side of the NS API: base URL, subscription key, timeout and errors."""

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from django.conf import settings

from api.ns import budget

BASE_URL = "https://gateway.apiportal.ns.nl/reisinformatie-api/api"
KEY_HEADER = "Ocp-Apim-Subscription-Key"
TIMEOUT_SECONDS = 10
HTTP_TOO_MANY_REQUESTS = 429


class NsError(Exception):
    """The NS API could not be reached or returned something unusable."""


class NsNotConfigured(NsError):
    """NS_API_KEY is not set."""


class NsBudgetExceeded(NsError):
    """A call was skipped because the NS call budget is used up."""


def get_json(url: str, params: dict[str, str] | None = None) -> Any:
    """GET a URL on the NS API gateway with our subscription key; any NS API uses this."""
    if not settings.NS_API_KEY:
        raise NsNotConfigured("NS_API_KEY is not set.")
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={KEY_HEADER: settings.NS_API_KEY})
    budget.record_call()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == HTTP_TOO_MANY_REQUESTS:
            path = urllib.parse.urlsplit(url).path
            budget.report("429", f"NS API answered 429 Too Many Requests for {path}")
        raise NsError(f"NS API request to {url} failed: {error}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise NsError(f"NS API request to {url} failed: {error}") from error


def get(path: str, params: dict[str, str] | None = None) -> Any:
    """GET a path of the Reisinformatie API."""
    return get_json(f"{BASE_URL}/{path}", params)
