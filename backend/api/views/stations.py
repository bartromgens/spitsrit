from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from api import ns, places
from api.serializers import OvFietsSerializer, StationSerializer, StationToiletsSerializer
from api.views.common import ns_error_response


@extend_schema(
    parameters=[OpenApiParameter("q", str, description="Part of a station name or its code")],
    responses={200: StationSerializer(many=True), 502: None, 503: None},
)
@api_view(["GET"])
@permission_classes([AllowAny])
def stations(request: Request) -> Response:
    """Search NS stations by name or code, for the commute form."""
    try:
        found = ns.search_stations(request.query_params.get("q", ""))
    except ns.NsError as error:
        return ns_error_response(error)
    return Response(StationSerializer(found, many=True).data)


@extend_schema(responses={200: OvFietsSerializer, 502: None, 503: None})
@api_view(["GET"])
@permission_classes([AllowAny])
def ov_fiets(request: Request, code: str) -> Response:
    """OV-fiets bikes available now at a station, per rental point and in total."""
    try:
        found = places.fetch_ov_fiets(code)
    except ns.NsError as error:
        return ns_error_response(error)
    return Response(OvFietsSerializer(found).data)


@extend_schema(responses={200: StationToiletsSerializer, 502: None, 503: None})
@api_view(["GET"])
@permission_classes([AllowAny])
def station_toilets(request: Request, code: str) -> Response:
    """The public toilets at a station, and whether each is open now."""
    try:
        found = places.fetch_toilets(code)
    except ns.NsError as error:
        return ns_error_response(error)
    return Response(StationToiletsSerializer(found).data)
