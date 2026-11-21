"""A small client for the NS Places API: OV-fiets availability at a station.

The official OpenAPI spec of this API is in `docs/ns-api/places-openapi.json`; where real
responses differ from it is in `docs/ns-api/NOTES.md`. The wire format is handled only by the
constants and the `parse_*` functions here.
"""

from dataclasses import dataclass
from typing import Any

from django.core.cache import cache

from api import ns

BASE_URL = "https://gateway.apiportal.ns.nl/places-api"
# The count changes as bikes are rented and returned; a minute matches the trips refresh.
OV_FIETS_CACHE_SECONDS = 60


@dataclass(frozen=True)
class OvFietsLocation:
    """One OV-fiets rental point at a station."""

    name: str
    # Bikes available now; `None` when NS does not give a number.
    available: int | None
    # Whether it is open now: "Yes", "No" or "Unknown".
    open: str


@dataclass(frozen=True)
class OvFiets:
    station_code: str
    locations: tuple[OvFietsLocation, ...] = ()

    @property
    def available(self) -> int | None:
        """Bikes you can rent now: at rental points not closed. `None` when none gives a number.

        A closed rental point still reports the bikes standing there, which cannot be rented.
        """
        counts = [
            loc.available
            for loc in self.locations
            if loc.available is not None and loc.open != "No"
        ]
        return sum(counts) if counts else None


def _get(path: str, params: dict[str, str] | None = None) -> Any:
    return ns.get_json(f"{BASE_URL}/{path}", params)


def _count(value: Any) -> int | None:
    """`extra.rentalBikes` is a string such as "33" in real responses."""
    try:
        count = int(str(value).strip())
    except ValueError:
        return None
    return count if count >= 0 else None


def parse_ov_fiets(payload: Any) -> tuple[OvFietsLocation, ...]:
    """The rental points in a `/v2/ovfiets` response: `payload[].locations[]`."""
    locations = []
    places = payload.get("payload") if isinstance(payload, dict) else None
    for place in places if isinstance(places, list) else []:
        items = place.get("locations") if isinstance(place, dict) else None
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            extra = item.get("extra")
            if not isinstance(extra, dict):
                extra = {}
            open_ = item.get("open")
            locations.append(
                OvFietsLocation(
                    name=str(item.get("description") or item.get("name") or "").strip(),
                    available=_count(extra.get("rentalBikes")),
                    open=open_ if open_ in ("Yes", "No") else "Unknown",
                )
            )
    return tuple(locations)


def fetch_ov_fiets(station_code: str) -> OvFiets:
    """OV-fiets availability at a station, cached for a minute."""
    code = station_code.strip().upper()
    key = f"ns:ovfiets:{code}"
    cached: OvFiets | None = cache.get(key)
    if cached is not None:
        return cached
    result = OvFiets(
        station_code=code,
        locations=parse_ov_fiets(_get("v2/ovfiets", {"station_code": code})),
    )
    cache.set(key, result, OV_FIETS_CACHE_SECONDS)
    return result
