import factory
from django.contrib.auth.models import User

from api.models import Commute


class UserFactory(factory.django.DjangoModelFactory[User]):
    class Meta:
        model = User

    username = factory.Sequence(lambda n: f"user{n}")
    password = factory.django.Password("secret-password")


class CommuteFactory(factory.django.DjangoModelFactory[Commute]):
    class Meta:
        model = Commute

    user = factory.SubFactory(UserFactory)
    name = factory.Sequence(lambda n: f"Commute {n}")
    origin_code = "UT"
    origin_name = "Utrecht Centraal"
    destination_code = "ASD"
    destination_name = "Amsterdam Centraal"
