from django.conf import settings
from django.http import FileResponse, Http404, HttpRequest
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from api import google
from api.serializers import ClientConfigSerializer


@extend_schema(responses=ClientConfigSerializer)
@api_view(["GET"])
@permission_classes([AllowAny])
def client_config(request: Request) -> Response:
    """Runtime config for the frontend, so one image serves every environment."""
    return Response(
        {
            "sentry_dsn": settings.SENTRY_DSN,
            "environment": settings.SENTRY_ENVIRONMENT,
            "release": settings.GIT_SHA,
            "google_login": google.is_configured(),
        }
    )


def spa_index(request: HttpRequest) -> FileResponse:
    """Serve the Angular index.html for client-side routes."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise Http404("Frontend build not found.")
    return FileResponse(index.open("rb"), content_type="text/html")
