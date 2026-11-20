from typing import Any

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from rest_framework import serializers

from api.models import Commute


class CommuteSerializer(serializers.ModelSerializer[Commute]):
    class Meta:
        model = Commute
        fields = [
            "id",
            "name",
            "origin_code",
            "origin_name",
            "destination_code",
            "destination_name",
            "usual_departure_time",
            "max_duration_minutes",
            "max_transfers",
            "created_at",
        ]
        read_only_fields = ["created_at"]

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        origin = attrs.get("origin_code", getattr(self.instance, "origin_code", None))
        destination = attrs.get(
            "destination_code", getattr(self.instance, "destination_code", None)
        )
        if origin is not None and origin == destination:
            raise serializers.ValidationError("Origin and destination must differ.")
        return attrs


class UserSerializer(serializers.ModelSerializer[User]):
    class Meta:
        model = User
        fields = ["id", "username"]


class LoginSerializer(serializers.Serializer[None]):
    email = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class RegisterSerializer(serializers.Serializer[None]):
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()
        if User.objects.filter(Q(username__iexact=email) | Q(email__iexact=email)).exists():
            raise serializers.ValidationError("An account with this email address already exists.")
        return email

    def validate(self, attrs: dict[str, str]) -> dict[str, str]:
        candidate = User(username=attrs["email"], email=attrs["email"])
        try:
            validate_password(attrs["password"], candidate)
        except DjangoValidationError as error:
            raise serializers.ValidationError({"password": list(error.messages)}) from error
        return attrs


class StationSerializer(serializers.Serializer[Any]):
    code = serializers.CharField()
    name = serializers.CharField()


class TripSerializer(serializers.Serializer[Any]):
    uid = serializers.CharField()
    departure_planned = serializers.DateTimeField()
    departure_actual = serializers.DateTimeField()
    arrival_planned = serializers.DateTimeField()
    arrival_actual = serializers.DateTimeField()
    departure_delay_minutes = serializers.IntegerField()
    arrival_delay_minutes = serializers.IntegerField()
    duration_minutes = serializers.IntegerField()
    departure_track = serializers.CharField()
    transfers = serializers.IntegerField()
    status = serializers.CharField()
    cancelled = serializers.BooleanField()
    crowd_forecast = serializers.CharField()
    train = serializers.CharField()
    train_length = serializers.IntegerField(allow_null=True)


class CommuteTripsSerializer(serializers.Serializer[None]):
    fetched_at = serializers.DateTimeField()
    trips = TripSerializer(many=True)
    recommended_uid = serializers.CharField(allow_null=True)
    wait_minutes = serializers.IntegerField(allow_null=True)


class ClientConfigSerializer(serializers.Serializer[None]):
    sentry_dsn = serializers.CharField()
    environment = serializers.CharField()
    release = serializers.CharField()
    google_login = serializers.BooleanField()
