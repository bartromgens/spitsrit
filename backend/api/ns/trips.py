"""Trips from the NS API: paging through them and enriching each with its train's journey."""

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any

from django.core.cache import cache
from django.utils import timezone

from api.ns import budget, client
from api.ns.client import NsError
from api.ns.models import JourneyInfo, Trip
from api.ns.parse import (
    parse_boarding_layout,
    parse_boarding_stock,
    parse_split,
    parse_train_origin,
    parse_trip,
    train_leg_indexes,
)

MAX_TRIPS = 15
MAX_TRIP_REQUESTS = 3
COVERED_MINUTES = 60

# Cache rules (also in docs/ns-api/NOTES.md). A journey only gives a train's composition: seats,
# carriages, units, facilities, origin, splits, the boarding layout and carriage crowding. That
# changes rarely, so it is cached: a minute for a train leaving within `SOON_DEPARTURE` (a
# last-minute change of train shows up quickly), five minutes for later trains. Delays, platforms,
# cancellations, crowd forecasts and the shorter-stock warning come from the trips call, which is
# never cached per leg, so they stay live; a whole search is cached for `TRIPS_CACHE_SECONDS`.
SOON_DEPARTURE = timedelta(minutes=10)
JOURNEY_SOON_CACHE_SECONDS = 60
JOURNEY_CACHE_SECONDS = 5 * 60
TRIPS_CACHE_SECONDS = 60

logger = logging.getLogger(__name__)


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


def _journey_cache_seconds(leg: dict[str, Any]) -> int:
    """How long to keep the leg's journey: briefly when the train leaves soon, else longer."""
    origin = leg.get("origin") or {}
    departure = origin.get("actualDateTime") or origin.get("plannedDateTime")
    try:
        leaves_in = datetime.fromisoformat(departure) - timezone.now() if departure else None
    except ValueError:
        leaves_in = None
    if leaves_in is not None and leaves_in <= SOON_DEPARTURE:
        return JOURNEY_SOON_CACHE_SECONDS
    return JOURNEY_CACHE_SECONDS


def _journey_stops(leg: dict[str, Any], key: str, params: dict[str, str]) -> list[Any] | None:
    """The stops of a journey, cached so repeated lookups don't multiply NS calls.

    `None` when the call budget says to skip the lookup. The cache time depends on the departure
    (see the cache rules at the top of this module).
    """
    cached: list[Any] | None = cache.get(key)
    if cached is not None:
        return cached
    if not budget.allow_journeys():
        return None
    stops = (client.get("v2/journey", params).get("payload") or {}).get("stops") or []
    cache.set(key, stops, _journey_cache_seconds(leg))
    return stops


def _leg_journey(leg: dict[str, Any] | None) -> JourneyInfo | None:
    """The size and first stop of the leg's train; unknown (`None`) when it can't be fetched."""
    request = _journey_request(leg) if leg else None
    if leg is None or request is None:
        return None
    key, params = request
    try:
        stops = _journey_stops(leg, key, params)
        if stops is None:
            return None
        boarding = (leg.get("origin") or {}).get("uicCode")
        alighting = (leg.get("destination") or {}).get("uicCode")
        coaches, platform = parse_boarding_layout(stops, boarding)
        return JourneyInfo(
            stock=parse_boarding_stock(stops, boarding),
            origin=parse_train_origin(stops),
            coach_crowding=coaches,
            platform_features=platform,
            split=parse_split(stops, boarding, alighting),
        )
    except NsError, AttributeError, TypeError:
        logger.warning("Could not read the journey for %s", key, exc_info=True)
        return None


def _journey_fields(info: JourneyInfo) -> dict[str, Any]:
    """The fields of a `Leg` or `Trip` that a journey fills in."""
    stock = info.stock
    return {
        "seats": stock.seats if stock else None,
        "carriages": stock.carriages if stock else None,
        "train_type": stock.train_type if stock else None,
        "train_parts": stock.parts if stock else (),
        "train_origin": info.origin,
        "coach_crowding": info.coach_crowding,
        "platform_features": info.platform_features,
        "split_stations": info.split.split_stations,
        "board_destination": info.split.board_destination,
    }


def _with_journeys(trip: Trip, infos: dict[int, JourneyInfo | None]) -> Trip:
    """The trip with each train leg's journey (by leg position), and the first train's on it."""
    legs = list(trip.legs)
    for index, info in infos.items():
        if info is not None and index < len(legs):
            legs[index] = replace(legs[index], **_journey_fields(info))
    first = infos[min(infos)] if infos else None
    trip = replace(trip, legs=tuple(legs))
    return replace(trip, **_journey_fields(first)) if first is not None else trip


def _dedup_key(leg: dict[str, Any]) -> tuple[str, str] | None:
    """What makes two legs share a lookup: the same train, boarding stop and alighting stop."""
    request = _journey_request(leg)
    if request is None:
        return None
    return request[0], str((leg.get("destination") or {}).get("uicCode"))


def _fetch_journeys(items: list[dict[str, Any]]) -> list[dict[int, JourneyInfo | None]]:
    """Per trip item, the journey of each train leg by leg position, fetched once per train."""
    wanted: dict[tuple[str, str], dict[str, Any]] = {}
    per_trip: list[dict[int, tuple[str, str] | None]] = []
    for item in items:
        legs = [leg for leg in item.get("legs") or [] if isinstance(leg, dict)]
        keys = {i: _dedup_key(legs[i]) for i in train_leg_indexes(item)}
        for i, key in keys.items():
            if key is not None:
                wanted.setdefault(key, legs[i])
        per_trip.append(keys)
    with ThreadPoolExecutor(max_workers=MAX_TRIPS) as pool:
        results = dict(zip(wanted, pool.map(_leg_journey, wanted.values()), strict=True))
    return [{i: results[key] if key else None for i, key in keys.items()} for keys in per_trip]


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
    arrive: bool = False,
) -> list[Trip]:
    """The trips of `_search_trips`, cached for a minute per search so a repeat makes no NS calls.

    The key holds the stations, the planning time to the minute, depart or arrive, and the
    filters. The cached trips are fully built, journeys included. Advice is not part of them: it
    is computed from the current time on every request.
    """
    minute = when.replace(second=0, microsecond=0).isoformat()
    key = (
        f"ns:trips:{origin_code}:{destination_code}:{minute}:{'arrive' if arrive else 'depart'}"
        f":{max_duration_minutes}:{max_transfers}"
    )
    cached: list[Trip] | None = cache.get(key)
    if cached is not None:
        return cached
    trips = _search_trips(
        origin_code, destination_code, when, max_duration_minutes, max_transfers, arrive
    )
    cache.set(key, trips, TRIPS_CACHE_SECONDS)
    return trips


def _search_trips(
    origin_code: str,
    destination_code: str,
    when: datetime,
    max_duration_minutes: int | None,
    max_transfers: int | None,
    arrive: bool,
) -> list[Trip]:
    """Trips from `when` on, within the filters, covering at least the next hour.

    With `arrive`, `when` is the arrival time instead: one page of NS's trips (`searchForArrival`),
    kept when they arrive by then, in departure order.

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
        if arrive:
            params["searchForArrival"] = "true"
        if context:
            params["context"] = context
        payload = client.get("v3/trips", params)
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
        if arrive:
            break
        context = _forward_context(payload)
        covered = any(trip.departure_actual >= horizon for trip, _ in kept)
        if covered or not added or not context:
            break
    if arrive:
        kept = [(trip, item) for trip, item in kept if trip.arrival_actual <= when]
        kept.sort(key=lambda pair: pair[0].departure_actual)
        kept = kept[-MAX_TRIPS:]
    else:
        kept = kept[:MAX_TRIPS]
    # Every train leg gets its size; the same train in several trips is looked up once.
    journeys = _fetch_journeys([item for _, item in kept])
    return [_with_journeys(trip, infos) for (trip, _), infos in zip(kept, journeys, strict=True)]
