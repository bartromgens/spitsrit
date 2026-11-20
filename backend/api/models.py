from django.contrib.auth.models import User
from django.db import models


class Commute(models.Model):
    """A journey a user makes regularly, between two NS stations."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="commutes")
    name = models.CharField(max_length=100)
    origin_code = models.CharField(max_length=20)
    origin_name = models.CharField(max_length=100)
    destination_code = models.CharField(max_length=20)
    destination_name = models.CharField(max_length=100)
    usual_departure_time = models.TimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name
