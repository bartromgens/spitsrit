from django.contrib import admin
from django.urls import include, path, re_path

from api.views.app import spa_index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
    # Everything else is an Angular route.
    re_path(r"^(?!api/|admin/|static/).*$", spa_index),
]
