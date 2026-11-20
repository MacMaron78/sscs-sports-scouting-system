from django.test import TestCase
from django.urls import reverse

from .models import AgencyProfile, AthleteProfile, Message, Shortlist, User


class RegistrationViewTests(TestCase):
    def test_athlete_registration_creates_athlete_profile(self):
        response = self.client.post(
            reverse("register"),
            {
                "username": "athlete1",
                "email": "athlete@example.com",
                "password1": "Strong-test-password-82!",
                "password2": "Strong-test-password-82!",
                "role": User.Role.ATHLETE,
                "athlete_first_name": "Avery",
                "athlete_last_name": "Player",
                "sport": "Football",
                "position": "Forward",
                "age": 20,
                "location": "London",
                "bio": "",
                "video_link": "",
            },
        )

        self.assertRedirects(response, reverse("registration_complete"))
        user = User.objects.get(username="athlete1")
        self.assertEqual(user.role, User.Role.ATHLETE)
        self.assertEqual(user.athlete_profile.sport, "Football")
        self.assertFalse(AgencyProfile.objects.filter(user=user).exists())

    def test_scout_registration_creates_agency_profile(self):
        response = self.client.post(
            reverse("register"),
            {
                "username": "scout1",
                "email": "scout@example.com",
                "password1": "Strong-test-password-82!",
                "password2": "Strong-test-password-82!",
                "role": User.Role.SCOUT,
                "agency_name": "Example Agency",
                "country": "UK",
                "contact_phone": "+44 20 1234 5678",
                "contact_details": "scout@example.com",
            },
        )

        self.assertRedirects(response, reverse("registration_complete"))
        user = User.objects.get(username="scout1")
        self.assertEqual(user.role, User.Role.SCOUT)
        self.assertEqual(user.agency_profile.agency_name, "Example Agency")
        self.assertEqual(user.agency_profile.contact_phone, "+44 20 1234 5678")
        self.assertFalse(AthleteProfile.objects.filter(user=user).exists())

    def test_missing_role_specific_fields_do_not_create_account(self):
        response = self.client.post(
            reverse("register"),
            {
                "username": "incomplete",
                "email": "incomplete@example.com",
                "password1": "Strong-test-password-82!",
                "password2": "Strong-test-password-82!",
                "role": User.Role.ATHLETE,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(username="incomplete").exists())


class AthleteSearchViewTests(TestCase):
    def setUp(self):
        self.scout = User.objects.create_user(
            username="search_scout",
            password="Strong-test-password-82!",
            role=User.Role.SCOUT,
        )
        AgencyProfile.objects.create(
            user=self.scout,
            agency_name="Search Agency",
            country="UK",
            contact_details="search@example.com",
        )
        self.athlete_user = User.objects.create_user(
            username="search_athlete",
            password="Strong-test-password-82!",
            role=User.Role.ATHLETE,
        )
        AthleteProfile.objects.create(
            user=self.athlete_user,
            first_name="Jordan",
            last_name="Example",
            sport="Basketball",
            position="Point Guard",
            age=22,
            location="New York",
        )

    def test_scout_can_filter_profiles_by_all_fields(self):
        self.client.force_login(self.scout)

        response = self.client.get(
            reverse("athlete_search"),
            {
                "sport": "basket",
                "position": "guard",
                "age": 22,
                "location": "new york",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertQuerySetEqual(
            response.context["athletes"],
            [AthleteProfile.objects.get(first_name="Jordan")],
        )

    def test_search_requires_login(self):
        response = self.client.get(reverse("athlete_search"))

        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response.url)

    def test_non_scout_cannot_search(self):
        self.client.force_login(self.athlete_user)

        response = self.client.get(reverse("athlete_search"))

        self.assertEqual(response.status_code, 403)

    def test_invalid_age_shows_form_error(self):
        self.client.force_login(self.scout)

        response = self.client.get(reverse("athlete_search"), {"age": "not-a-number"})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.context["form"].is_valid())
        self.assertFalse(response.context["athletes"])


class ShortlistViewTests(TestCase):
    def setUp(self):
        self.scout = User.objects.create_user(
            username="shortlist_scout",
            password="Strong-test-password-82!",
            role=User.Role.SCOUT,
        )
        self.agency = AgencyProfile.objects.create(
            user=self.scout,
            agency_name="Example Agency",
            country="UK",
            contact_details="agency@example.com",
        )
        athlete_user = User.objects.create_user(
            username="shortlist_athlete",
            password="Strong-test-password-82!",
            role=User.Role.ATHLETE,
        )
        self.athlete = AthleteProfile.objects.create(
            user=athlete_user,
            first_name="Riley",
            last_name="Example",
            sport="Tennis",
            position="Singles",
            age=19,
            location="London",
        )

    def test_scout_can_add_athlete_and_view_shortlist(self):
        self.client.force_login(self.scout)

        response = self.client.post(
            reverse("add_to_shortlist", args=[self.athlete.pk])
        )

        self.assertRedirects(response, reverse("my_shortlist"))
        self.assertTrue(
            Shortlist.objects.filter(agency=self.agency, athlete=self.athlete).exists()
        )
        self.assertIsNotNone(
            Shortlist.objects.get(agency=self.agency, athlete=self.athlete).created_at
        )

        response = self.client.get(reverse("my_shortlist"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            list(response.context["shortlist"].values_list("athlete_id", flat=True)),
            [self.athlete.pk],
        )

    def test_adding_same_athlete_twice_does_not_duplicate_entry(self):
        self.client.force_login(self.scout)
        url = reverse("add_to_shortlist", args=[self.athlete.pk])

        self.client.post(url)
        self.client.post(url)

        self.assertEqual(
            Shortlist.objects.filter(agency=self.agency, athlete=self.athlete).count(),
            1,
        )

    def test_shortlist_action_requires_post(self):
        self.client.force_login(self.scout)

        response = self.client.get(
            reverse("add_to_shortlist", args=[self.athlete.pk])
        )

        self.assertEqual(response.status_code, 405)
        self.assertFalse(Shortlist.objects.exists())

    def test_non_scout_cannot_add_to_shortlist(self):
        athlete_user = User.objects.create_user(
            username="not_a_scout",
            password="Strong-test-password-82!",
            role=User.Role.ATHLETE,
        )
        self.client.force_login(athlete_user)

        response = self.client.post(
            reverse("add_to_shortlist", args=[self.athlete.pk])
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Shortlist.objects.exists())

    def test_shortlist_is_private_to_each_agency(self):
        other_scout = User.objects.create_user(
            username="other_scout",
            password="Strong-test-password-82!",
            role=User.Role.SCOUT,
        )
        AgencyProfile.objects.create(
            user=other_scout,
            agency_name="Other Agency",
            country="US",
            contact_details="other@example.com",
        )
        Shortlist.objects.create(agency=self.agency, athlete=self.athlete)
        self.client.force_login(other_scout)

        response = self.client.get(reverse("my_shortlist"))

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.context["shortlist"].exists())


class MessagingViewTests(TestCase):
    def setUp(self):
        self.sender = User.objects.create_user(
            username="message_sender",
            password="Strong-test-password-82!",
            role=User.Role.SCOUT,
        )
        AgencyProfile.objects.create(
            user=self.sender,
            agency_name="Sender Agency",
            country="UK",
            contact_details="sender@example.com",
        )
        self.recipient = User.objects.create_user(
            username="message_recipient",
            password="Strong-test-password-82!",
            role=User.Role.ATHLETE,
        )
        self.athlete = AthleteProfile.objects.create(
            user=self.recipient,
            first_name="Casey",
            last_name="Athlete",
            sport="Swimming",
            position="Freestyle",
            age=21,
            location="Manchester",
        )

    def test_scout_can_send_message_from_athlete_profile(self):
        self.client.force_login(self.sender)

        profile_response = self.client.get(
            reverse("athlete_profile", args=[self.athlete.pk])
        )
        self.assertContains(profile_response, reverse("send_message", args=[self.recipient.pk]))

        response = self.client.post(
            reverse("send_message", args=[self.recipient.pk]),
            {"body": "Are you available for a trial?"},
        )

        self.assertRedirects(response, reverse("inbox"))
        message = Message.objects.get()
        self.assertEqual(message.sender, self.sender)
        self.assertEqual(message.recipient, self.recipient)
        self.assertEqual(message.body, "Are you available for a trial?")
        self.assertFalse(message.is_read)

    def test_agency_profile_has_send_message_link(self):
        self.client.force_login(self.recipient)
        agency = self.sender.agency_profile

        response = self.client.get(reverse("agency_profile", args=[agency.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, reverse("send_message", args=[self.sender.pk]))

    def test_inbox_separates_received_and_sent_messages(self):
        Message.objects.create(
            sender=self.sender,
            recipient=self.recipient,
            body="Sent to athlete",
        )
        Message.objects.create(
            sender=self.recipient,
            recipient=self.sender,
            body="Reply from athlete",
        )
        self.client.force_login(self.sender)

        response = self.client.get(reverse("inbox"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(list(response.context["received_messages"].values_list("body", flat=True)), ["Reply from athlete"])
        self.assertEqual(list(response.context["sent_messages"].values_list("body", flat=True)), ["Sent to athlete"])

    def test_message_recipient_must_have_a_profile(self):
        unprofiled_user = User.objects.create_user(
            username="unprofiled",
            password="Strong-test-password-82!",
        )
        self.client.force_login(self.sender)

        response = self.client.get(reverse("send_message", args=[unprofiled_user.pk]))

        self.assertEqual(response.status_code, 404)

    def test_anonymous_user_is_redirected_from_inbox(self):
        response = self.client.get(reverse("inbox"))

        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response.url)


class FrontendPageTests(TestCase):
    def test_homepage_displays_registration_and_login_actions(self):
        response = self.client.get(reverse("home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, reverse("register"))
        self.assertContains(response, reverse("login"))

    def test_registration_page_renders_role_specific_form(self):
        response = self.client.get(reverse("register"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Athlete profile")
        self.assertContains(response, "Scout / agency profile")

    def test_login_page_renders_custom_template(self):
        response = self.client.get(reverse("login"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Log in to SSCS")

    def test_successful_login_redirects_to_home(self):
        User.objects.create_user(
            username="login_test",
            password="Strong-test-password-82!",
            role=User.Role.ATHLETE,
        )

        response = self.client.post(
            reverse("login"),
            {"username": "login_test", "password": "Strong-test-password-82!"},
        )

        self.assertRedirects(response, reverse("home"))

    def test_agency_directory_and_athlete_profile_render(self):
        athlete_user = User.objects.create_user(
            username="frontend_athlete",
            password="Strong-test-password-82!",
            role=User.Role.ATHLETE,
        )
        athlete = AthleteProfile.objects.create(
            user=athlete_user,
            first_name="Taylor",
            last_name="Runner",
            sport="Athletics",
            position="Sprinter",
            age=23,
            location="Bristol",
        )
        self.client.force_login(athlete_user)

        directory_response = self.client.get(reverse("agency_directory"))
        profile_response = self.client.get(
            reverse("athlete_profile", args=[athlete.pk])
        )

        self.assertEqual(directory_response.status_code, 200)
        self.assertEqual(profile_response.status_code, 200)
        self.assertContains(profile_response, "Taylor Runner")
