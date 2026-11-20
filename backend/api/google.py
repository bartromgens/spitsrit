"""Sign in with Google, using the OAuth 2.0 authorization code flow.

Google's userinfo endpoint is called with the access token we just received over TLS
from Google's token endpoint, so no ID token signature has to be checked here.
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from django.conf import settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
TIMEOUT_SECONDS = 10


class GoogleError(Exception):
    """The Google sign-in could not be completed."""


@dataclass(frozen=True)
class GoogleProfile:
    sub: str
    email: str
    name: str


def is_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def authorization_url(redirect_uri: str, state: str) -> str:
    query = urllib.parse.urlencode(
        {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "prompt": "select_account",
        }
    )
    return f"{AUTH_URL}?{query}"


def _send(request: urllib.request.Request) -> Any:
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise GoogleError("Google is not answering.") from error


def fetch_profile(code: str, redirect_uri: str) -> GoogleProfile:
    """Trade the authorization code for the verified profile of the Google user."""
    body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode()
    token = _send(urllib.request.Request(TOKEN_URL, data=body))
    access_token = token.get("access_token") if isinstance(token, dict) else None
    if not access_token:
        raise GoogleError("Google returned no access token.")
    info = _send(
        urllib.request.Request(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    )
    if not isinstance(info, dict) or not info.get("sub"):
        raise GoogleError("Google returned no profile.")
    if info.get("email_verified") is not True or not info.get("email"):
        raise GoogleError("The Google account has no verified email address.")
    return GoogleProfile(
        sub=str(info["sub"]), email=str(info["email"]), name=str(info.get("name", ""))
    )
