"""Which trip to take: the business rule on top of the NS trips."""

from dataclasses import dataclass
from datetime import datetime

from api.ns.models import Trip


@dataclass(frozen=True)
class Advice:
    recommended_uid: str | None
    wait_minutes: int | None


def advise(trips: list[Trip], now: datetime, arrive: bool = False) -> Advice:
    """Pick the trip that gets you there first; on a tie, the one that leaves latest.

    When planning by arrival, every trip arrives in time, so pick the one that leaves latest.

    `wait_minutes` is how long until that trip leaves: 0 means leave now.
    """
    candidates = [t for t in trips if not t.cancelled and t.departure_actual >= now]
    if not candidates:
        return Advice(None, None)
    if arrive:
        best = max(candidates, key=lambda t: t.departure_actual)
    else:
        best = min(candidates, key=lambda t: (t.arrival_actual, -t.departure_actual.timestamp()))
    wait = max(0, round((best.departure_actual - now).total_seconds() / 60))
    return Advice(best.uid, wait)
