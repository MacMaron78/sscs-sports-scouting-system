from django.db import transaction
from django.contrib.auth.decorators import login_required
from django.http import HttpResponseForbidden
from django.db.models import Q
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .forms import AthleteSearchForm, MessageForm, RegistrationForm
from .models import AgencyProfile, AthleteProfile, Message, Shortlist, User


def home(request):
    athletes = AthleteProfile.objects.select_related("user").order_by("-pk")[:6]
    agencies = AgencyProfile.objects.select_related("user").order_by("agency_name")[:6]
    return render(
        request,
        "core/home.html",
        {"athletes": athletes, "agencies": agencies},
    )


def register(request):
    if request.method == "POST":
        form = RegistrationForm(request.POST)
        if form.is_valid():
            with transaction.atomic():
                user = form.save(commit=False)
                user.role = form.cleaned_data["role"]
                user.save()

                if user.role == User.Role.ATHLETE:
                    AthleteProfile.objects.create(
                        user=user,
                        first_name=form.cleaned_data["athlete_first_name"],
                        last_name=form.cleaned_data["athlete_last_name"],
                        sport=form.cleaned_data["sport"],
                        position=form.cleaned_data["position"],
                        age=form.cleaned_data["age"],
                        location=form.cleaned_data["location"],
                        bio=form.cleaned_data["bio"],
                        video_link=form.cleaned_data["video_link"],
                    )
                elif user.role == User.Role.SCOUT:
                    AgencyProfile.objects.create(
                        user=user,
                        agency_name=form.cleaned_data["agency_name"],
                        country=form.cleaned_data["country"],
                        contact_phone=form.cleaned_data["contact_phone"],
                        contact_details=form.cleaned_data["contact_details"],
                    )

            return redirect("registration_complete")
    else:
        form = RegistrationForm()

    return render(request, "core/register.html", {"form": form})


def registration_complete(request):
    return render(request, "core/registration_complete.html")


@login_required
def athlete_search(request):
    if request.user.role != User.Role.SCOUT:
        return HttpResponseForbidden("Only registered scouts and agencies can search athlete profiles.")

    try:
        agency = request.user.agency_profile
    except AgencyProfile.DoesNotExist:
        return HttpResponseForbidden("Your scout account does not have an agency profile.")

    form = AthleteSearchForm(request.GET)
    athletes = AthleteProfile.objects.none()
    if form.is_valid():
        athletes = AthleteProfile.objects.select_related("user").order_by(
            "last_name", "first_name"
        )
        filters = {
            f"{field}__icontains": form.cleaned_data[field]
            for field in ("sport", "position", "location")
            if form.cleaned_data[field]
        }
        if filters:
            athletes = athletes.filter(**filters)
        if form.cleaned_data["age"] is not None:
            athletes = athletes.filter(age=form.cleaned_data["age"])

    return render(
        request,
        "core/athlete_search.html",
        {
            "form": form,
            "athletes": athletes,
            "shortlisted_athlete_ids": agency.shortlists.values_list("athlete_id", flat=True),
        },
    )


@login_required
@require_POST
def add_to_shortlist(request, athlete_id):
    if request.user.role != User.Role.SCOUT:
        return HttpResponseForbidden("Only registered scouts and agencies can create shortlists.")

    try:
        agency = request.user.agency_profile
    except AgencyProfile.DoesNotExist:
        return HttpResponseForbidden("Your scout account does not have an agency profile.")

    athlete = get_object_or_404(AthleteProfile, pk=athlete_id)
    Shortlist.objects.get_or_create(agency=agency, athlete=athlete)
    return redirect("my_shortlist")


@login_required
def my_shortlist(request):
    if request.user.role != User.Role.SCOUT:
        return HttpResponseForbidden("Only registered scouts and agencies can view shortlists.")

    try:
        agency = request.user.agency_profile
    except AgencyProfile.DoesNotExist:
        return HttpResponseForbidden("Your scout account does not have an agency profile.")

    shortlist = agency.shortlists.select_related("athlete", "athlete__user").order_by(
        "athlete__last_name", "athlete__first_name"
    )
    return render(request, "core/my_shortlist.html", {"shortlist": shortlist})


@login_required
def athlete_profile(request, athlete_id):
    athlete = get_object_or_404(
        AthleteProfile.objects.select_related("user"),
        pk=athlete_id,
    )
    return render(request, "core/athlete_profile.html", {"athlete": athlete})


@login_required
def agency_profile(request, agency_id):
    agency = get_object_or_404(
        AgencyProfile.objects.select_related("user"),
        pk=agency_id,
    )
    return render(request, "core/agency_profile.html", {"agency": agency})


def agency_directory(request):
    agencies = AgencyProfile.objects.select_related("user").order_by("agency_name")
    return render(request, "core/agency_directory.html", {"agencies": agencies})


@login_required
def send_message(request, recipient_id):
    recipient = get_object_or_404(
        User.objects.filter(
            Q(athlete_profile__isnull=False) | Q(agency_profile__isnull=False)
        ),
        pk=recipient_id,
    )
    if recipient == request.user:
        return HttpResponseForbidden("You cannot send a message to yourself.")

    if request.method == "POST":
        form = MessageForm(request.POST)
        if form.is_valid():
            message = form.save(commit=False)
            message.sender = request.user
            message.recipient = recipient
            message.save()
            return redirect("inbox")
    else:
        form = MessageForm()

    return render(
        request,
        "core/send_message.html",
        {"form": form, "recipient": recipient},
    )


@login_required
def inbox(request):
    received_messages = (
        Message.objects.filter(recipient=request.user)
        .select_related("sender")
        .order_by("-sent_at")
    )
    sent_messages = (
        Message.objects.filter(sender=request.user)
        .select_related("recipient")
        .order_by("-sent_at")
    )
    return render(
        request,
        "core/inbox.html",
        {
            "received_messages": received_messages,
            "sent_messages": sent_messages,
        },
    )
