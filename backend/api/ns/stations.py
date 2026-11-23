"""The list of NS stations, and searching it."""

from django.core.cache import cache

from api.ns import client
from api.ns.models import Station
from api.ns.parse import parse_stations

# Bump the version when `Station` changes, so a cached list of the old shape is not reused.
STATIONS_CACHE_KEY = "ns:stations:v2"
STATIONS_CACHE_SECONDS = 24 * 60 * 60


def fetch_stations() -> list[Station]:
    """All stations, cached for a day: the list barely changes and is large."""
    cached: list[Station] | None = cache.get(STATIONS_CACHE_KEY)
    if cached is not None:
        return cached
    stations = parse_stations(client.get("v2/stations"))
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
