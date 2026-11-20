"""A small client for the NS Reisinformatie API, and the trip logic built on it.

The request paths, query parameters, header name and response fields below follow the
NS API portal as remembered at build time. They are NOT yet verified against a live
response: the portal documentation is behind a login. Check them with a real key
(`make`-free: `curl -H "Ocp-Apim-Subscription-Key: $NS_API_KEY" <url>`) and fix the
constants and the `parse_*` functions here; nothing else depends on the wire format.
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from django.conf import settings
from django.core.cache import cache

BASE_URL = "https://gateway.apiportal.ns.nl/reisinformatie-api/api"
KEY_HEADER = "Ocp-Apim-Subscription-Key"
STATIONS_CACHE_KEY = "ns:stations"
STATIONS_CACHE_SECONDS = 24 * 60 * 60
TIMEOUT_SECONDS = 10
MAX_TRIPS = 6


class NsError(Exception):
    """The NS API could not be reached or returned something unusable."""


class NsNotConfigured(NsError):
    """NS_API_KEY is not set."""


@dataclass(frozen=True)
class Station:
    code: str
    name: str


@dataclass(frozen=True)
class Trip:
    uid: str
    departure_planned: datetime
    departure_actual: datetime
    arrival_planned: datetime
    arrival_actual: datetime
    departure_track: str
    transfers: int
    status: str
    cancelled: bool
    crowd_forecast: str
    train: str
    train_length: int | None = None

    @property
    def departure_delay_minutes(self) -> int:
        return round((self.departure_actual - self.departure_planned).total_seconds() / 60)

    @property
    def arrival_delay_minutes(self) -> int:
        return round((self.arrival_actual - self.arrival_planned).total_seconds() / 60)

    @property
    def duration_minutes(self) -> int:
        return round((self.arrival_actual - self.departure_actual).total_seconds() / 60)


def _get(path: str, params: dict[str, str] | None = None) -> Any:
    if not settings.NS_API_KEY:
        raise NsNotConfigured("NS_API_KEY is not set.")
    url = f"{BASE_URL}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={KEY_HEADER: settings.NS_API_KEY})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise NsError(f"NS API request to {path} failed: {error}") from error


def _time(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def parse_stations(payload: Any) -> list[Station]:
    stations = []
    for item in payload.get("payload", []):
        code = item.get("code")
        name = (item.get("namen") or {}).get("lang")
        if code and name:
            stations.append(Station(code=code, name=name))
    return stations


def _train_length(leg: dict[str, Any]) -> int | None:
    """Number of train units (treinstellen) of the leg's train, if NS reports it."""
    parts = (leg.get("stock") or {}).get("numberOfParts")
    return parts if isinstance(parts, int) and parts > 0 else None


def parse_trip(item: dict[str, Any]) -> Trip | None:
    legs = item.get("legs") or []
    if not legs:
        return None
    first, last = legs[0], legs[-1]
    origin, destination = first.get("origin") or {}, last.get("destination") or {}
    departure_planned = _time(origin.get("plannedDateTime"))
    arrival_planned = _time(destination.get("plannedDateTime"))
    if departure_planned is None or arrival_planned is None:
        return None
    product = first.get("product") or {}
    train = f"{product.get('shortCategoryName', '')} {product.get('number', '')}".strip()
    return Trip(
        uid=str(item.get("uid") or item.get("ctxRecon") or ""),
        departure_planned=departure_planned,
        departure_actual=_time(origin.get("actualDateTime")) or departure_planned,
        arrival_planned=arrival_planned,
        arrival_actual=_time(destination.get("actualDateTime")) or arrival_planned,
        departure_track=str(origin.get("actualTrack") or origin.get("plannedTrack") or ""),
        transfers=int(item.get("transfers") or 0),
        status=str(item.get("status") or ""),
        cancelled=any(leg.get("cancelled") for leg in legs) or item.get("status") == "CANCELLED",
        crowd_forecast=str(item.get("crowdForecast") or ""),
        train=train,
        train_length=_train_length(first),
    )


def fetch_stations() -> list[Station]:
    """All stations, cached for a day: the list barely changes and is large."""
    cached: list[Station] | None = cache.get(STATIONS_CACHE_KEY)
    if cached is not None:
        return cached
    stations = parse_stations(_get("v2/stations"))
    cache.set(STATIONS_CACHE_KEY, stations, STATIONS_CACHE_SECONDS)
    return stations


def search_stations(query: str, limit: int = 15) -> list[Station]:
    needle = query.strip().casefold()
    if not needle:
        return []
    stations = fetch_stations()
    exact = [s for s in stations if s.code.casefold() == needle]
    starts = [s for s in stations if s.name.casefold().startswith(needle) and s not in exact]
    contains = [
        s for s in stations if needle in s.name.casefold() and s not in exact and s not in starts
    ]
    return (exact + starts + contains)[:limit]


def fetch_trips(origin_code: str, destination_code: str, when: datetime) -> list[Trip]:
    payload = _get(
        "v3/trips",
        {
            "fromStation": origin_code,
            "toStation": destination_code,
            "dateTime": when.isoformat(),
        },
    )
    trips = (parse_trip(item) for item in payload.get("trips", []))
    return [trip for trip in trips if trip is not None][:MAX_TRIPS]


@dataclass(frozen=True)
class Advice:
    recommended_uid: str | None
    wait_minutes: int | None


def advise(trips: list[Trip], now: datetime) -> Advice:
    """Pick the trip that gets you there first; on a tie, the one that leaves latest.

    `wait_minutes` is how long until that trip leaves: 0 means leave now.
    """
    candidates = [t for t in trips if not t.cancelled and t.departure_actual >= now]
    if not candidates:
        return Advice(None, None)
    best = min(candidates, key=lambda t: (t.arrival_actual, -t.departure_actual.timestamp()))
    wait = max(0, round((best.departure_actual - now).total_seconds() / 60))
    return Advice(best.uid, wait)
