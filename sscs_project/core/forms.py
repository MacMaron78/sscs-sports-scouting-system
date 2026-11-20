from django import forms
from django.contrib.auth.forms import UserCreationForm

from .models import Message, User


class AthleteSearchForm(forms.Form):
    sport = forms.CharField(max_length=100, required=False)
    position = forms.CharField(max_length=100, required=False)
    age = forms.IntegerField(min_value=0, max_value=32767, required=False)
    location = forms.CharField(max_length=255, required=False)


class MessageForm(forms.ModelForm):
    class Meta:
        model = Message
        fields = ("body",)
        widgets = {
            "body": forms.Textarea(attrs={"rows": 5}),
        }


class RegistrationForm(UserCreationForm):
    role = forms.ChoiceField(
        choices=(
            (User.Role.ATHLETE, "Athlete"),
            (User.Role.SCOUT, "Scout/Agency"),
        )
    )
    athlete_first_name = forms.CharField(max_length=150, required=False)
    athlete_last_name = forms.CharField(max_length=150, required=False)
    sport = forms.CharField(max_length=100, required=False)
    position = forms.CharField(max_length=100, required=False)
    age = forms.IntegerField(min_value=0, max_value=32767, required=False)
    location = forms.CharField(max_length=255, required=False)
    bio = forms.CharField(widget=forms.Textarea, required=False)
    video_link = forms.URLField(required=False)
    agency_name = forms.CharField(max_length=255, required=False)
    country = forms.CharField(max_length=100, required=False)
    contact_phone = forms.CharField(
        label="Contact phone",
        max_length=32,
        required=False,
    )
    contact_details = forms.CharField(widget=forms.Textarea, required=False)

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("username", "email")

    def clean(self):
        cleaned_data = super().clean()
        role = cleaned_data.get("role")

        if role == User.Role.ATHLETE:
            required_fields = (
                "athlete_first_name",
                "athlete_last_name",
                "sport",
                "position",
                "location",
            )
        elif role == User.Role.SCOUT:
            required_fields = (
                "agency_name",
                "country",
                "contact_phone",
                "contact_details",
            )
        else:
            required_fields = ()

        for field_name in required_fields:
            if not cleaned_data.get(field_name):
                self.add_error(field_name, "This field is required for this account type.")

        return cleaned_data
