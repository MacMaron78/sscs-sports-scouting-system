from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class User(AbstractUser):
    class Role(models.TextChoices):
        ATHLETE = "athlete", "Athlete"
        SCOUT = "scout", "Scout"
        ADMIN = "admin", "Admin"

    role = models.CharField(max_length=10, choices=Role.choices, default=Role.ATHLETE)

    def __str__(self):
        return self.username


class AthleteProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="athlete_profile",
    )
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    sport = models.CharField(max_length=100)
    position = models.CharField(max_length=100)
    age = models.PositiveSmallIntegerField(null=True, blank=True)
    location = models.CharField(max_length=255)
    bio = models.TextField(blank=True)
    video_link = models.URLField(blank=True)

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


class AgencyProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="agency_profile",
    )
    agency_name = models.CharField(max_length=255)
    country = models.CharField(max_length=100)
    contact_phone = models.CharField(max_length=32, blank=True, default="")
    contact_details = models.TextField()

    def __str__(self):
        return self.agency_name


class Shortlist(models.Model):
    agency = models.ForeignKey(
        AgencyProfile,
        on_delete=models.CASCADE,
        related_name="shortlists",
    )
    athlete = models.ForeignKey(
        AthleteProfile,
        on_delete=models.CASCADE,
        related_name="shortlists",
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("agency", "athlete"),
                name="unique_agency_athlete_shortlist",
            ),
        ]

    def __str__(self):
        return f"{self.agency} - {self.athlete}"


class Message(models.Model):
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_messages",
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="received_messages",
    )
    body = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    def __str__(self):
        return f"Message from {self.sender} to {self.recipient}"
