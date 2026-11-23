from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView
from rest_framework.routers import DefaultRouter

from api.views import app, auth, stations, trips

router = DefaultRouter()
router.register("commutes", trips.CommuteViewSet, basename="commute")

urlpatterns = [
    path("stations/", stations.stations, name="stations"),
    path("stations/<slug:code>/ov-fiets/", stations.ov_fiets, name="station-ov-fiets"),
    path("stations/<slug:code>/toilets/", stations.station_toilets, name="station-toilets"),
    path("trips/", trips.plan_trip, name="plan-trip"),
    path("", include(router.urls)),
    path("config/", app.client_config, name="client-config"),
    path("auth/me/", auth.me, name="auth-me"),
    path("auth/login/", auth.login_view, name="auth-login"),
    path("auth/register/", auth.register_view, name="auth-register"),
    path("auth/google/", auth.google_start, name="auth-google"),
    path("auth/google/callback/", auth.google_callback, name="auth-google-callback"),
    path("auth/logout/", auth.logout_view, name="auth-logout"),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
]
