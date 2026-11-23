"""Parsers of NS API responses. The wire format is handled only here and in `client`."""

from datetime import datetime
from typing import Any

from api.ns.models import (
    SHORTER_STOCK_CLASSIFICATIONS,
    STATION_TYPES,
    Leg,
    LegStop,
    Span,
    SplitInfo,
    Station,
    Stock,
    TrainPart,
    Trip,
)


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


def train_leg(item: dict[str, Any]) -> dict[str, Any] | None:
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


def _count(value: Any) -> int | None:
    """A count that may be zero; `None` when NS leaves it out or sends something else."""
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _positive_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _text(value: Any) -> str | None:
    return str(value) if value else None


def _station_name(station: Any) -> str | None:
    """The name of a station object: `name` in journey responses, `namen.lang` per the spec."""
    if not isinstance(station, dict):
        return None
    return _text(station.get("name")) or _text((station.get("namen") or {}).get("lang"))


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
            destination=_station_name(part.get("destination")),
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


def _boarding_stop(stops: list[Any], boarding_uic_code: str | None) -> dict[str, Any] | None:
    """The stop of a `/v2/journey` response where the leg boards.

    That is the one NS marks `kind == "DEPARTURE"` (only set when the request passes
    `departureUicCode`); failing that, the one whose `uicCode` is the leg's origin.
    """
    journey_stops = [s for s in stops if isinstance(s, dict)]
    return next((s for s in journey_stops if s.get("kind") == "DEPARTURE"), None) or next(
        (
            s
            for s in journey_stops
            if boarding_uic_code and (s.get("stop") or {}).get("uicCode") == boarding_uic_code
        ),
        None,
    )


def parse_boarding_stock(stops: list[Any], boarding_uic_code: str | None) -> Stock | None:
    """The stock at the boarding stop (see `_boarding_stop`); `actualStock` wins over planned."""
    boarding = _boarding_stop(stops, boarding_uic_code)
    if boarding is None:
        return None
    return _parse_stock(boarding.get("actualStock")) or _parse_stock(boarding.get("plannedStock"))


def _spans(items: Any, kind_key: str) -> tuple[Span, ...]:
    spans = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        start, width = _count(item.get("paddingLeft")), _positive_int(item.get("width"))
        if start is None or width is None:
            continue
        spans.append(
            Span(
                start=start,
                width=width,
                kind=str(item.get(kind_key) or "UNKNOWN"),
                description=str(item.get("description") or ""),
            )
        )
    return tuple(spans)


def parse_boarding_layout(
    stops: list[Any], boarding_uic_code: str | None
) -> tuple[tuple[Span, ...], tuple[Span, ...]]:
    """Crowding per carriage and the platform features at the boarding stop.

    Real responses have sent both as empty arrays so far (see docs/ns-api/NOTES.md); this is
    kept so the details show them once NS fills them. The layout of the spans is unverified.
    """
    boarding = _boarding_stop(stops, boarding_uic_code)
    if boarding is None:
        return (), ()
    return (
        _spans(boarding.get("coachCrowdForecast"), "classification"),
        _spans(boarding.get("platformFeatures"), "type"),
    )


def _stops_ahead(stops: list[dict[str, Any]], start: dict[str, Any]) -> list[dict[str, Any]]:
    """The stops from `start` on, following `nextStopId` (the first one where it branches)."""
    by_id = {str(s["id"]): s for s in stops if s.get("id")}
    ahead: list[dict[str, Any]] = []
    current: dict[str, Any] | None = start
    while current is not None and current not in ahead:
        ahead.append(current)
        following = current.get("nextStopId") or []
        current = by_id.get(str(following[0])) if following else None
    return ahead


def parse_split(
    stops: list[Any], boarding_uic_code: str | None, alighting_uic_code: str | None
) -> SplitInfo:
    """Where units of the train stay behind, and which part to board to reach the rider's stop.

    NS does not mark splits with a `SPLIT` status; the units at the boarding stop each have a
    `destination` instead, and the journey follows the part that goes furthest. A unit whose
    destination comes before the journey's end stays behind there. `board_destination` is only
    set when that matters: when some units do not get as far as the rider's stop.
    """
    journey_stops = [s for s in stops if isinstance(s, dict)]
    boarding = _boarding_stop(journey_stops, boarding_uic_code)
    if boarding is None:
        return SplitInfo()
    ahead = _stops_ahead(journey_stops, boarding)
    position = {(s.get("stop") or {}).get("uicCode"): i for i, s in enumerate(ahead)}
    stock = boarding.get("actualStock") or boarding.get("plannedStock") or {}
    parts = [p for p in stock.get("trainParts") or [] if isinstance(p, dict)]
    # Each unit's destination with how far along the journey it is, when it is on the journey.
    reach: list[tuple[int, str]] = []
    for part in parts:
        destination = part.get("destination") or {}
        index = position.get(destination.get("uicCode"))
        name = _station_name(destination)
        if index is not None and name:
            reach.append((index, name))
    last = len(ahead) - 1
    split_stations = tuple(dict.fromkeys(name for index, name in sorted(reach) if index < last))
    if not split_stations:
        return SplitInfo()
    alighting = position.get(alighting_uic_code)
    board_destination = None
    if alighting is not None and any(index < alighting for index, _ in reach):
        enough = {name for index, name in reach if index >= alighting}
        board_destination = enough.pop() if len(enough) == 1 else None
    return SplitInfo(split_stations, board_destination)


def parse_train_origin(stops: list[Any]) -> str | None:
    """Where the whole train starts: the name of the first stop of a `/v2/journey` response."""
    first = stops[0] if stops else None
    name = (first.get("stop") or {}).get("name") if isinstance(first, dict) else None
    return str(name) if name else None


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
        origin_code=_text(origin.get("stationCode")),
        destination_code=_text(destination.get("stationCode")),
        bicycle_spots=_positive_int(leg.get("bicycleSpotCount")),
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
    direction = (train_leg(item) or {}).get("direction")
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
