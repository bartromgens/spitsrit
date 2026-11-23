from rest_framework import status
from rest_framework.response import Response

from api import ns


def ns_error_response(error: ns.NsError) -> Response:
    if isinstance(error, ns.NsNotConfigured):
        return Response(
            {"detail": "Train data is not configured on this server."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return Response({"detail": "The NS API is not answering."}, status=status.HTTP_502_BAD_GATEWAY)
