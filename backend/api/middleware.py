from collections.abc import Callable

from django.conf import settings
from django.db import connection
from django.http import HttpRequest, HttpResponse, JsonResponse


class HealthzMiddleware:
    """Serve /healthz before any other middleware, so ALLOWED_HOSTS does not apply."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if request.path != "/healthz":
            return self.get_response(request)
        try:
            connection.ensure_connection()
            db = "ok"
        except Exception:
            db = "error"
        return JsonResponse(
            {"status": "ok" if db == "ok" else "error", "version": settings.GIT_SHA, "db": db},
            status=200 if db == "ok" else 503,
        )
