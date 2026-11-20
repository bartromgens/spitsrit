from django.contrib import admin

from api.models import Commute


@admin.register(Commute)
# ModelAdmin is only subscriptable for mypy, not at runtime, so the type argument cannot be given.
class CommuteAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name", "user", "origin_name", "destination_name", "usual_departure_time")
    list_filter = ("user",)
    search_fields = ("name", "origin_name", "destination_name")
