"""A small client for the NS Reisinformatie API, and the trip logic built on it.

The official OpenAPI spec of this API is in `docs/ns-api/reisinformatie-openapi.json`
(the NS portal docs are behind a login). Check request paths, parameters and response
fields against it. The wire format is handled only by the constants and the `parse_*`
functions here; nothing else depends on it.
"""

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any

from django.conf import settings
from django.core.cache import cache

BASE_URL = "https://gateway.apiportal.ns.nl/reisinformatie-api/api"
KEY_HEADER = "Ocp-Apim-Subscription-Key"
# Bump the version when `Station` changes, so a cached list of the old shape is not reused.
STATIONS_CACHE_KEY = "ns:stations:v2"
STATIONS_CACHE_SECONDS = 24 * 60 * 60
TIMEOUT_SECONDS = 10
MAX_TRIPS = 15
MAX_TRIP_REQUESTS = 3
COVERED_MINUTES = 60
JOURNEY_CACHE_SECONDS = 2 * 60
SHORTER_STOCK_CLASSIFICATIONS = ("BUSY", "EXTRA_BUSY")
# NS `stationType` values from most to least important, as seen in real `v2/stations` responses.
# Unknown types rank after all of these.
STATION_TYPES = (
    "MEGA_STATION",
    "KNOOPPUNT_INTERCITY_STATION",
    "INTERCITY_STATION",
    "KNOOPPUNT_SNELTREIN_STATION",
    "SNELTREIN_STATION",
    "KNOOPPUNT_STOPTREIN_STATION",
    "STOPTREIN_STATION",
    "FACULTATIEF_STATION",
)

logger = logging.getLogger(__name__)


class NsError(Exception):
    """The NS API could not be reached or returned something unusable."""


class NsNotConfigured(NsError):
    """NS_API_KEY is not set."""


@dataclass(frozen=True)
class Station:
    code: str
    name: str
    # Lower is more important: the index of the NS `stationType` in `STATION_TYPES`.
    rank: int = field(default=len(STATION_TYPES), compare=False)


@dataclass(frozen=True)
class TrainPart:
    """One unit of a train: its NS stock number and facilities (`WIFI`, `TOILET`, `STILTE`...)."""

    stock_identifier: str
    facilities: tuple[str, ...] = ()
    # NS's side view of the unit (`image.uri`), only when it is an https URL.
    image_url: str | None = None


@dataclass(frozen=True)
class LegStop:
    """A stop on a leg, from the leg's `stops` in the trips response. Tracks fall back to planned."""

    name: str
    arrival_planned: datetime | None
    arrival_actual: datetime | None
    departure_planned: datetime | None
    departure_actual: datetime | None
    track: str | None
    track_changed: bool
    passing: bool
    cancelled: bool


@dataclass(frozen=True)
class Leg:
    """One part of a trip: a train ride, or a walk between two stations."""

    travel_type: str
    name: str
    category: str | None
    operator: str | None
    direction: str | None
    origin: str
    departure_planned: datetime | None
    departure_actual: datetime | None
    departure_track: str | None
    departure_track_changed: bool
    destination: str
    arrival_planned: datetime | None
    arrival_actual: datetime | None
    arrival_track: str | None
    arrival_track_changed: bool
    exit_side: str | None
    cancelled: bool
    crowd_forecast: str
    punctuality: float | None
    stops: tuple[LegStop, ...] = ()
    notes: tuple[str, ...] = ()
    messages: tuple[str, ...] = ()
    transfer_messages: tuple[str, ...] = ()
    shorter_stock_warning: str | None = None


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
    seats: int | None = None
    carriages: int | None = None
    train_type: str | None = None
    shorter_stock: str | None = None
    shorter_stock_warning: str | None = None
    train_origin: str | None = None
    train_destination: str | None = None
    train_parts: tuple[TrainPart, ...] = ()
    punctuality: float | None = None
    messages: tuple[str, ...] = ()
    legs: tuple[Leg, ...] = ()

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


def _station_rank(station_type: Any) -> int:
    if station_type in STATION_TYPES:
        return STATION_TYPES.index(station_type)
    return len(STATION_TYPES)


def parse_stations(payload: Any) -> list[Station]:
    stations = []
    for item in payload.get("payload", []):
        code = item.get("code")
        name = (item.get("namen") or {}).get("lang")
        if code and name:
            stations.append(
                Station(code=code, name=name, rank=_station_rank(item.get("stationType")))
            )
    return stations


def _train_leg(item: dict[str, Any]) -> dict[str, Any] | None:
    """The first leg that is a public-transit ride: the one whose train size we show."""
    for leg in item.get("legs") or []:
        if leg.get("travelType") == "PUBLIC_TRANSIT":
            return dict(leg)
    return None


def _shorter_stock(legs: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """The first shorter-than-usual classification of any leg, with NS's warning text."""
    for leg in legs:
        classification = leg.get("shorterStockClassification")
        if classification in SHORTER_STOCK_CLASSIFICATIONS:
            warning = leg.get("shorterStockWarning")
            return classification, str(warning) if warning else None
    return None, None


@dataclass(frozen=True)
class Stock:
    seats: int | None
    carriages: int | None
    train_type: str | None
    # Two stocks are equal when they have the same size; the units are only shown as details.
    parts: tuple[TrainPart, ...] = field(default=(), compare=False)


def _positive_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _image_url(image: Any) -> str | None:
    uri = image.get("uri") if isinstance(image, dict) else None
    return uri if isinstance(uri, str) and uri.startswith("https://") else None


def _train_parts(parts: Any) -> tuple[TrainPart, ...]:
    if not isinstance(parts, list):
        return ()
    return tuple(
        TrainPart(
            stock_identifier=str(part.get("stockIdentifier") or ""),
            facilities=tuple(str(f) for f in part.get("facilities") or [] if f),
            image_url=_image_url(part.get("image")),
        )
        for part in parts
        if isinstance(part, dict)
    )


def _parse_stock(stock: Any) -> Stock | None:
    if not isinstance(stock, dict):
        return None
    result = Stock(
        seats=_positive_int(stock.get("numberOfSeats")),
        carriages=_positive_int(stock.get("numberOfParts")),
        train_type=str(stock["trainType"]) if stock.get("trainType") else None,
        parts=_train_parts(stock.get("trainParts")),
    )
    return result if result.seats or result.carriages else None


def parse_boarding_stock(stops: list[Any], boarding_uic_code: str | None) -> Stock | None:
    """The stock at the stop where the leg boards, from the `stops` of a `/v2/journey` response.

    The boarding stop is the one NS marks `kind == "DEPARTURE"` (only set when the request
    passes `departureUicCode`); failing that, the one whose `uicCode` is the leg's origin.
    `actualStock` wins over `plannedStock`.
    """
    journey_stops = [s for s in stops if isinstance(s, dict)]
    boarding = next((s for s in journey_stops if s.get("kind") == "DEPARTURE"), None) or next(
        (
            s
            for s in journey_stops
            if boarding_uic_code and (s.get("stop") or {}).get("uicCode") == boarding_uic_code
        ),
        None,
    )
    if boarding is None:
        return None
    return _parse_stock(boarding.get("actualStock")) or _parse_stock(boarding.get("plannedStock"))


def parse_train_origin(stops: list[Any]) -> str | None:
    """Where the whole train starts: the name of the first stop of a `/v2/journey` response."""
    first = stops[0] if stops else None
    name = (first.get("stop") or {}).get("name") if isinstance(first, dict) else None
    return str(name) if name else None


def _text(value: Any) -> str | None:
    return str(value) if value else None


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _track(actual: Any, planned: Any) -> tuple[str | None, bool]:
    """The track to use (actual over planned) and whether it differs from the planned one."""
    track = _text(actual) or _text(planned)
    return track, bool(actual and planned and actual != planned)


def _messages(items: Any) -> tuple[str, ...]:
    """Disruption and maintenance messages as text: their head, then their text."""
    texts = []
    for message in items if isinstance(items, list) else []:
        if isinstance(message, dict):
            text = " - ".join(str(message[k]) for k in ("head", "text") if message.get(k))
            if text:
                texts.append(text)
    return tuple(dict.fromkeys(texts))


def _notes(items: Any) -> tuple[str, ...]:
    """Note values; product notes come as a list of lists, so nested lists are flattened."""
    texts: list[str] = []
    for note in items if isinstance(items, list) else []:
        if isinstance(note, list):
            texts.extend(_notes(note))
        elif isinstance(note, dict) and note.get("value"):
            texts.append(str(note["value"]))
    return tuple(dict.fromkeys(texts))


def _parse_leg_stop(stop: dict[str, Any]) -> LegStop:
    track, changed = _track(
        stop.get("actualDepartureTrack") or stop.get("actualArrivalTrack"),
        stop.get("plannedDepartureTrack") or stop.get("plannedArrivalTrack"),
    )
    return LegStop(
        name=str(stop.get("name") or ""),
        arrival_planned=_time(stop.get("plannedArrivalDateTime")),
        arrival_actual=_time(stop.get("actualArrivalDateTime")),
        departure_planned=_time(stop.get("plannedDepartureDateTime")),
        departure_actual=_time(stop.get("actualDepartureDateTime")),
        track=track,
        track_changed=changed,
        passing=bool(stop.get("passing")),
        cancelled=bool(stop.get("cancelled")),
    )


def parse_leg(leg: dict[str, Any]) -> Leg:
    """Every detail of a leg of the trips response that riders can use."""
    origin, destination = leg.get("origin") or {}, leg.get("destination") or {}
    product = leg.get("product") or {}
    departure_track, departure_changed = _track(
        origin.get("actualTrack"), origin.get("plannedTrack")
    )
    arrival_track, arrival_changed = _track(
        destination.get("actualTrack"), destination.get("plannedTrack")
    )
    name = f"{product.get('shortCategoryName', '')} {product.get('number', '')}".strip()
    return Leg(
        travel_type=str(leg.get("travelType") or "UNKNOWN"),
        name=name or str(leg.get("name") or ""),
        category=_text(product.get("longCategoryName")),
        operator=_text(product.get("operatorName")),
        direction=_text(leg.get("direction")),
        origin=str(origin.get("name") or ""),
        departure_planned=_time(origin.get("plannedDateTime")),
        departure_actual=_time(origin.get("actualDateTime")),
        departure_track=departure_track,
        departure_track_changed=departure_changed,
        destination=str(destination.get("name") or ""),
        arrival_planned=_time(destination.get("plannedDateTime")),
        arrival_actual=_time(destination.get("actualDateTime")),
        arrival_track=arrival_track,
        arrival_track_changed=arrival_changed,
        exit_side=_text(destination.get("exitSide")),
        cancelled=bool(leg.get("cancelled")),
        crowd_forecast=str(leg.get("crowdForecast") or ""),
        punctuality=_number(leg.get("punctuality")),
        stops=tuple(_parse_leg_stop(s) for s in leg.get("stops") or [] if isinstance(s, dict)),
        notes=_notes(leg.get("notes")) + _notes(product.get("notes")),
        messages=_messages(leg.get("messages")),
        transfer_messages=tuple(
            str(m["message"])
            for m in leg.get("transferMessages") or []
            if isinstance(m, dict) and m.get("message")
        ),
        shorter_stock_warning=_text(leg.get("shorterStockWarning")),
    )


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
    shorter_stock, shorter_stock_warning = _shorter_stock(legs)
    direction = (_train_leg(item) or {}).get("direction")
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
        shorter_stock=shorter_stock,
        shorter_stock_warning=shorter_stock_warning,
        train_destination=str(direction) if direction else None,
        punctuality=_number(item.get("punctuality")),
        messages=_messages(item.get("messages")),
        legs=tuple(parse_leg(leg) for leg in legs if isinstance(leg, dict)),
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
    """Code matches, then name prefixes, then name substrings; big stations first in each."""
    needle = query.strip().casefold()
    if not needle:
        return []
    stations = sorted(fetch_stations(), key=lambda s: (s.rank, s.name.casefold()))
    exact = [s for s in stations if s.code.casefold() == needle]
    starts = [s for s in stations if s.name.casefold().startswith(needle) and s not in exact]
    contains = [
        s for s in stations if needle in s.name.casefold() and s not in exact and s not in starts
    ]
    return (exact + starts + contains)[:limit]


def _journey_request(leg: dict[str, Any]) -> tuple[str, dict[str, str]] | None:
    """Cache key and query for the leg's journey: by `journeyDetailRef`, else by train number.

    Always passes `departureUicCode`, which makes NS mark the boarding stop.
    """
    origin = leg.get("origin") or {}
    boarding = origin.get("uicCode")
    extra = {"departureUicCode": str(boarding)} if boarding else {}
    ref = leg.get("journeyDetailRef")
    if ref:
        return f"ns:journey:{ref}:{boarding}", {"id": str(ref), **extra}
    number = (leg.get("product") or {}).get("number")
    departure = origin.get("plannedDateTime")
    if number and departure:
        return f"ns:journey:train:{number}:{departure}:{boarding}", {
            "train": str(number),
            "dateTime": str(departure),
            **extra,
        }
    return None


def _journey_stops(key: str, params: dict[str, str]) -> list[Any]:
    """The stops of a journey, cached briefly so repeated lookups don't multiply NS calls."""
    cached: list[Any] | None = cache.get(key)
    if cached is not None:
        return cached
    stops = (_get("v2/journey", params).get("payload") or {}).get("stops") or []
    cache.set(key, stops, JOURNEY_CACHE_SECONDS)
    return stops


@dataclass(frozen=True)
class JourneyInfo:
    stock: Stock | None
    origin: str | None


def _leg_journey(leg: dict[str, Any] | None) -> JourneyInfo | None:
    """The size and first stop of the leg's train; unknown (`None`) when it can't be fetched."""
    request = _journey_request(leg) if leg else None
    if leg is None or request is None:
        return None
    key, params = request
    try:
        stops = _journey_stops(key, params)
        return JourneyInfo(
            stock=parse_boarding_stock(stops, (leg.get("origin") or {}).get("uicCode")),
            origin=parse_train_origin(stops),
        )
    except NsError, AttributeError, TypeError:
        logger.warning("Could not read the journey for %s", key, exc_info=True)
        return None


def _with_journey(trip: Trip, info: JourneyInfo | None) -> Trip:
    if info is None:
        return trip
    stock = info.stock
    return replace(
        trip,
        seats=stock.seats if stock else None,
        carriages=stock.carriages if stock else None,
        train_type=stock.train_type if stock else None,
        train_parts=stock.parts if stock else (),
        train_origin=info.origin,
    )


def _forward_context(payload: dict[str, Any]) -> str | None:
    """The `context` that asks for the next page of trips, if NS offers one."""
    context = payload.get("scrollRequestForwardContext")
    if not context:
        items = payload.get("trips") or []
        context = items[-1].get("scrollRequestForwardContext") if items else None
    return str(context) if context else None


def fetch_trips(
    origin_code: str,
    destination_code: str,
    when: datetime,
    max_duration_minutes: int | None = None,
    max_transfers: int | None = None,
) -> list[Trip]:
    """Trips from `when` on, within the filters, covering at least the next hour.

    Requests pages forward (at most `MAX_TRIP_REQUESTS`) until the last kept trip leaves
    `COVERED_MINUTES` or more after `when`, NS has no further page, or a page adds nothing new.
    """
    kept: list[tuple[Trip, dict[str, Any]]] = []
    seen: set[str] = set()
    context: str | None = None
    horizon = when + timedelta(minutes=COVERED_MINUTES)
    for _ in range(MAX_TRIP_REQUESTS):
        params = {
            "fromStation": origin_code,
            "toStation": destination_code,
            "dateTime": when.isoformat(),
        }
        if context:
            params["context"] = context
        payload = _get("v3/trips", params)
        added = False
        for item in payload.get("trips", []):
            trip = parse_trip(item)
            if trip is None or trip.uid in seen:
                continue
            seen.add(trip.uid)
            added = True
            if (max_duration_minutes is None or trip.duration_minutes <= max_duration_minutes) and (
                max_transfers is None or trip.transfers <= max_transfers
            ):
                kept.append((trip, item))
        context = _forward_context(payload)
        covered = any(trip.departure_actual >= horizon for trip, _ in kept)
        if covered or not added or not context:
            break
    kept = kept[:MAX_TRIPS]
    # Only the first train leg of a trip is shown, so only its journey is fetched.
    with ThreadPoolExecutor(max_workers=MAX_TRIPS) as pool:
        journeys = list(pool.map(_leg_journey, [_train_leg(item) for _, item in kept]))
    return [_with_journey(trip, info) for (trip, _), info in zip(kept, journeys, strict=True)]


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
