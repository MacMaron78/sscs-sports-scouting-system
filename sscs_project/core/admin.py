from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import AgencyProfile, AthleteProfile, Message, Shortlist, User


@admin.register(User)
class SSCSUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ("SSCS role", {"fields": ("role",)}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("SSCS role", {"fields": ("role",)}),
    )
    list_display = ("username", "email", "role", "is_staff", "is_active")
    list_filter = ("role", "is_staff", "is_active")


@admin.register(AthleteProfile)
class AthleteProfileAdmin(admin.ModelAdmin):
    list_display = ("first_name", "last_name", "sport", "position", "location")
    search_fields = ("first_name", "last_name", "sport", "location")


@admin.register(AgencyProfile)
class AgencyProfileAdmin(admin.ModelAdmin):
    list_display = ("agency_name", "country", "contact_phone", "user")
    search_fields = ("agency_name", "country", "user__username")


@admin.register(Shortlist)
class ShortlistAdmin(admin.ModelAdmin):
    list_display = ("agency", "athlete")
    list_select_related = ("agency", "athlete")


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("sender", "recipient", "sent_at")
    list_select_related = ("sender", "recipient")
    search_fields = ("sender__username", "recipient__username", "body")
