"""The NS API call budget: a rolling count of calls, guards that shed load, and Sentry warnings.

The NS key allows 300 calls per 5 minutes, shared by the Reisinformatie and Places APIs. Every
call is counted in the Django cache in short buckets, summed over the last `WINDOW_SECONDS`.
Above `NS_JOURNEY_CALL_LIMIT` journey lookups are skipped; above `NS_PLACES_CALL_LIMIT` Places
calls are skipped too. Trip searches are never skipped.
"""

import logging
import time

import sentry_sdk
from django.conf import settings
from django.core.cache import cache

WINDOW_SECONDS = 5 * 60
BUCKET_SECONDS = 15
# Sentry gets at most one warning of each kind per this many seconds.
REPORT_INTERVAL_SECONDS = 60

logger = logging.getLogger(__name__)


def _now() -> float:
    return time.time()


def _bucket_keys() -> list[str]:
    current = int(_now() // BUCKET_SECONDS)
    return [f"ns:calls:{current - i}" for i in range(WINDOW_SECONDS // BUCKET_SECONDS)]


def record_call() -> None:
    """Count one NS API call in the current bucket."""
    key = _bucket_keys()[0]
    # A bucket outlives the window, so it is never dropped while it still counts.
    if cache.add(key, 1, WINDOW_SECONDS + BUCKET_SECONDS):
        return
    try:
        cache.incr(key)
    except ValueError:  # it expired between add and incr
        cache.set(key, 1, WINDOW_SECONDS + BUCKET_SECONDS)


def call_count() -> int:
    """The NS API calls made in the last five minutes."""
    return sum(cache.get_many(_bucket_keys()).values())


def report(kind: str, message: str) -> None:
    """Log `message` and warn Sentry with the call count, at most once a minute per kind."""
    count = call_count()
    logger.warning("%s (%d NS calls in the last 5 minutes)", message, count)
    interval = int(_now() // REPORT_INTERVAL_SECONDS)
    if cache.add(f"ns:report:{kind}:{interval}", 1, REPORT_INTERVAL_SECONDS):
        with sentry_sdk.new_scope() as scope:
            scope.set_extra("ns_calls_in_window", count)
            sentry_sdk.capture_message(f"{message} ({count} calls in 5 minutes)", level="warning")


def allow_journeys() -> bool:
    """Whether a journey lookup may go to NS; reports when the budget says no."""
    if call_count() <= settings.NS_JOURNEY_CALL_LIMIT:
        return True
    report("skip-journeys", "NS call budget exceeded: skipping journey lookups")
    return False


def allow_places() -> bool:
    """Whether a Places call may go to NS; reports when the budget says no."""
    if call_count() <= settings.NS_PLACES_CALL_LIMIT:
        return True
    report("skip-places", "NS call budget exceeded: skipping Places calls")
    return False
