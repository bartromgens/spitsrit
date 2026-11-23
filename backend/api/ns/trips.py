"""Trips from the NS API: paging through them and enriching each with its train's journey."""

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any

from django.core.cache import cache

from api.ns import client
from api.ns.client import NsError
from api.ns.models import JourneyInfo, Trip
from api.ns.parse import (
    parse_boarding_layout,
    parse_boarding_stock,
    parse_split,
    parse_train_origin,
    parse_trip,
    train_leg,
)

MAX_TRIPS = 15
MAX_TRIP_REQUESTS = 3
COVERED_MINUTES = 60
JOURNEY_CACHE_SECONDS = 2 * 60

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


def _journey_stops(key: str, params: dict[str, str]) -> list[Any]:
    """The stops of a journey, cached briefly so repeated lookups don't multiply NS calls."""
    cached: list[Any] | None = cache.get(key)
    if cached is not None:
        return cached
    stops = (client.get("v2/journey", params).get("payload") or {}).get("stops") or []
    cache.set(key, stops, JOURNEY_CACHE_SECONDS)
    return stops


def _leg_journey(leg: dict[str, Any] | None) -> JourneyInfo | None:
    """The size and first stop of the leg's train; unknown (`None`) when it can't be fetched."""
    request = _journey_request(leg) if leg else None
    if leg is None or request is None:
        return None
    key, params = request
    try:
        stops = _journey_stops(key, params)
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
        coach_crowding=info.coach_crowding,
        platform_features=info.platform_features,
        split_stations=info.split.split_stations,
        board_destination=info.split.board_destination,
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
    arrive: bool = False,
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
    # Only the first train leg of a trip is shown, so only its journey is fetched.
    with ThreadPoolExecutor(max_workers=MAX_TRIPS) as pool:
        journeys = list(pool.map(_leg_journey, [train_leg(item) for _, item in kept]))
    return [_with_journey(trip, info) for (trip, _), info in zip(kept, journeys, strict=True)]
