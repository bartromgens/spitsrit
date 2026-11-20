from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView
from rest_framework.routers import DefaultRouter

from api import views

router = DefaultRouter()
router.register("commutes", views.CommuteViewSet, basename="commute")

urlpatterns = [
    path("stations/", views.stations, name="stations"),
    path("trips/", views.plan_trip, name="plan-trip"),
    path("", include(router.urls)),
    path("config/", views.client_config, name="client-config"),
    path("auth/me/", views.me, name="auth-me"),
    path("auth/login/", views.login_view, name="auth-login"),
    path("auth/logout/", views.logout_view, name="auth-logout"),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
]
