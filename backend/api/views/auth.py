import secrets

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.urls import reverse
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from api import google
from api.models import GoogleAccount
from api.serializers import LoginSerializer, RegisterSerializer, UserSerializer

GOOGLE_STATE_KEY = "google_oauth_state"
LOGIN_ERROR_URL = "/login?error=google"


@extend_schema(responses={200: UserSerializer, 204: None})
@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def me(request: Request) -> Response:
    """The logged-in user, or 204 when logged out. Also sets the CSRF cookie."""
    if not request.user.is_authenticated:
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(UserSerializer(request.user).data)


@extend_schema(request=LoginSerializer, responses={200: UserSerializer, 400: None})
@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request: Request) -> Response:
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    identifier = serializer.validated_data["email"].strip()
    # Accounts made before email login may have a username that is not an email address.
    account = (
        User.objects.filter(username=identifier).first()
        or User.objects.filter(username__iexact=identifier).order_by("id").first()
        or User.objects.filter(email__iexact=identifier).order_by("id").first()
    )
    user = authenticate(
        request._request,
        username=account.username if account else identifier,
        password=serializer.validated_data["password"],
    )
    if user is None:
        return Response(
            {"detail": "Invalid email or password."}, status=status.HTTP_400_BAD_REQUEST
        )
    login(request._request, user)
    return Response(UserSerializer(user).data)


@extend_schema(request=RegisterSerializer, responses={201: UserSerializer, 400: None})
@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request: Request) -> Response:
    """Create an account with an email address and password, and log in."""
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = serializer.validated_data["email"]
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=email, email=email, password=serializer.validated_data["password"]
            )
    except IntegrityError:
        # A concurrent registration with the same email won the race.
        return Response(
            {"email": ["An account with this email address already exists."]},
            status=status.HTTP_400_BAD_REQUEST,
        )
    login(request._request, user, backend="django.contrib.auth.backends.ModelBackend")
    return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


def google_redirect_uri(request: HttpRequest) -> str:
    return request.build_absolute_uri(reverse("auth-google-callback"))


def user_for_google(profile: google.GoogleProfile) -> User:
    """The user for a Google account, created on the first login.

    Accounts are matched on Google's stable subject id and never on email, so a Google
    login cannot take over an existing password account.
    """
    linked = GoogleAccount.objects.select_related("user").filter(sub=profile.sub).first()
    if linked:
        return linked.user
    with transaction.atomic():
        username = profile.email
        if User.objects.filter(username=username).exists():
            username = f"{profile.email}#{profile.sub}"
        user = User.objects.create_user(
            username=username[:150], email=profile.email, first_name=profile.name[:150]
        )
        user.set_unusable_password()
        user.save(update_fields=["password"])
        GoogleAccount.objects.create(user=user, sub=profile.sub)
    return user


@extend_schema(request=None, responses={302: None})
@api_view(["GET"])
@permission_classes([AllowAny])
def google_start(request: Request) -> HttpResponse:
    """Send the browser to Google to sign in."""
    if not google.is_configured():
        return HttpResponseRedirect(LOGIN_ERROR_URL)
    state = secrets.token_urlsafe(32)
    request._request.session[GOOGLE_STATE_KEY] = state
    return HttpResponseRedirect(
        google.authorization_url(google_redirect_uri(request._request), state)
    )


@extend_schema(
    parameters=[OpenApiParameter("code", str), OpenApiParameter("state", str)],
    request=None,
    responses={302: None},
)
@api_view(["GET"])
@permission_classes([AllowAny])
def google_callback(request: Request) -> HttpResponse:
    """Finish the Google sign-in, creating the account on first login."""
    expected = request._request.session.pop(GOOGLE_STATE_KEY, None)
    state = request.query_params.get("state", "")
    code = request.query_params.get("code", "")
    if (
        not google.is_configured()
        or not expected
        or not secrets.compare_digest(str(expected), state)
        or not code
    ):
        return HttpResponseRedirect(LOGIN_ERROR_URL)
    try:
        profile = google.fetch_profile(code, google_redirect_uri(request._request))
    except google.GoogleError:
        return HttpResponseRedirect(LOGIN_ERROR_URL)
    login(
        request._request,
        user_for_google(profile),
        backend="django.contrib.auth.backends.ModelBackend",
    )
    return HttpResponseRedirect("/commutes")


@extend_schema(request=None, responses={204: None})
@api_view(["POST"])
def logout_view(request: Request) -> Response:
    logout(request._request)
    return Response(status=status.HTTP_204_NO_CONTENT)
