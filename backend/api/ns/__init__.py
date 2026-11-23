"""A small client for the NS Reisinformatie API, and the trip logic built on it.

The official OpenAPI spec of this API is in `docs/ns-api/reisinformatie-openapi.json`
(the NS portal docs are behind a login). Check request paths, parameters and response
fields against it. The wire format is handled only by `client` and the `parse_*` functions
in `parse`; nothing else depends on it.

The submodules are `client` (HTTP, errors), `models` (data classes), `parse` (response
parsers), `stations`, `trips` and `advice`. The public names are re-exported here so callers
can keep using `ns.fetch_trips`, `ns.NsError` and so on.
"""

from api.ns.advice import Advice, advise
from api.ns.client import NsError, NsNotConfigured, get_json
from api.ns.models import (
    STATION_TYPES,
    JourneyInfo,
    Leg,
    LegStop,
    Span,
    SplitInfo,
    Station,
    Stock,
    TrainPart,
    Trip,
)
from api.ns.parse import (
    parse_boarding_layout,
    parse_boarding_stock,
    parse_leg,
    parse_split,
    parse_stations,
    parse_train_origin,
    parse_trip,
)
from api.ns.stations import fetch_stations, search_stations
from api.ns.trips import MAX_TRIP_REQUESTS, MAX_TRIPS, fetch_trips

__all__ = [
    "MAX_TRIPS",
    "MAX_TRIP_REQUESTS",
    "STATION_TYPES",
    "Advice",
    "JourneyInfo",
    "Leg",
    "LegStop",
    "NsError",
    "NsNotConfigured",
    "Span",
    "SplitInfo",
    "Station",
    "Stock",
    "TrainPart",
    "Trip",
    "advise",
    "fetch_stations",
    "fetch_trips",
    "get_json",
    "parse_boarding_layout",
    "parse_boarding_stock",
    "parse_leg",
    "parse_split",
    "parse_stations",
    "parse_train_origin",
    "parse_trip",
    "search_stations",
]
