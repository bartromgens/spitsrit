"""The data classes the NS API's responses are parsed into."""

from dataclasses import dataclass, field
from datetime import datetime

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
    # Where this unit goes; units differ when the train splits along the way.
    destination: str | None = None


@dataclass(frozen=True)
class Span:
    """Something placed along the train or platform, in NS's own units from the train's front.

    `start` is NS's `paddingLeft` and `width` its `width`. NS does not document the unit; the
    frontend scales all spans of a stop to the longest one.
    """

    start: int
    width: int
    kind: str
    description: str = ""


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
    # NS station codes (`stationCode`) of where the leg starts and ends, when it is a station.
    origin_code: str | None = None
    destination_code: str | None = None
    bicycle_spots: int | None = None
    # The train's size and layout at this leg's own boarding stop; unknown for walks and when
    # the journey could not be read. Same meaning as the fields of `Trip`, which has the first
    # train's.
    seats: int | None = None
    carriages: int | None = None
    train_type: str | None = None
    train_origin: str | None = None
    train_parts: tuple[TrainPart, ...] = ()
    coach_crowding: tuple[Span, ...] = ()
    platform_features: tuple[Span, ...] = ()
    split_stations: tuple[str, ...] = ()
    board_destination: str | None = None


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
    # Crowding per carriage and what stands along the platform, at the boarding stop.
    coach_crowding: tuple[Span, ...] = ()
    platform_features: tuple[Span, ...] = ()
    # Where units of the train stay behind, from the boarding stop on.
    split_stations: tuple[str, ...] = ()
    # Only when some units stop short of the rider's stop: where the part to board goes.
    board_destination: str | None = None

    @property
    def min_seats(self) -> int | None:
        """The fewest seats of any train leg with a known size, `None` when none is known."""
        known = [leg.seats for leg in self.legs if leg.seats is not None]
        return min(known) if known else None

    @property
    def departure_delay_minutes(self) -> int:
        return round((self.departure_actual - self.departure_planned).total_seconds() / 60)

    @property
    def arrival_delay_minutes(self) -> int:
        return round((self.arrival_actual - self.arrival_planned).total_seconds() / 60)

    @property
    def duration_minutes(self) -> int:
        return round((self.arrival_actual - self.departure_actual).total_seconds() / 60)


@dataclass(frozen=True)
class Stock:
    seats: int | None
    carriages: int | None
    train_type: str | None
    # Two stocks are equal when they have the same size; the units are only shown as details.
    parts: tuple[TrainPart, ...] = field(default=(), compare=False)


@dataclass(frozen=True)
class SplitInfo:
    split_stations: tuple[str, ...] = ()
    board_destination: str | None = None


@dataclass(frozen=True)
class JourneyInfo:
    stock: Stock | None
    origin: str | None
    coach_crowding: tuple[Span, ...] = ()
    platform_features: tuple[Span, ...] = ()
    split: SplitInfo = SplitInfo()
