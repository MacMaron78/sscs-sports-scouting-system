from django.urls import path

from . import views


urlpatterns = [
    path("", views.home, name="home"),
    path("register/", views.register, name="register"),
    path("registration/complete/", views.registration_complete, name="registration_complete"),
    path("athletes/search/", views.athlete_search, name="athlete_search"),
    path("athletes/<int:athlete_id>/shortlist/", views.add_to_shortlist, name="add_to_shortlist"),
    path("my-shortlist/", views.my_shortlist, name="my_shortlist"),
    path("athletes/<int:athlete_id>/", views.athlete_profile, name="athlete_profile"),
    path("agencies/<int:agency_id>/", views.agency_profile, name="agency_profile"),
    path("agencies/", views.agency_directory, name="agency_directory"),
    path("messages/send/<int:recipient_id>/", views.send_message, name="send_message"),
    path("inbox/", views.inbox, name="inbox"),
]
