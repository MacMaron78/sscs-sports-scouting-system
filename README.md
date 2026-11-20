# SSCS

The proposal-aligned implementation is a responsive React frontend, a Node.js/Express REST API, and PostgreSQL. The original Django project and its existing `public` schema are preserved alongside it.

## Application layout

- `sscs_frontend/` — React and Vite website (development URL: `http://localhost:5173`)
- `sscs_node/` — Express REST API (development URL: `http://localhost:5000/api`)
- `sscs_project/` — original Django implementation (development URL: `http://127.0.0.1:8000`)

The React/Node implementation creates its own `sscs_api` schema inside the configured PostgreSQL database. This keeps the original Django tables and records untouched. Accounts created in React are separate from existing Django accounts; no data is deleted or automatically copied between them.

The Vite development server proxies `/api` requests to the Node API so browser sessions use the same local origin as the frontend. Set `VITE_API_URL` only when connecting to a separately hosted API.

## One-time setup (PowerShell)

Node.js LTS and npm are required. Open two terminals in the workspace folder.

In the first terminal, configure and start the API:

```powershell
cd .\sscs_node
Copy-Item .env.example .env
notepad .env
```

In `.env`, set `PGPASSWORD` to the PostgreSQL password, and replace `JWT_SECRET` with a random string of at least 32 characters. Keep `.env` private and do not commit it. The defaults connect to database `sscs_db` as `postgres` on `localhost:5432` and create the isolated `sscs_api` schema.

Then run:

```powershell
npm install
npm run create-admin
npm run dev
```

`npm run create-admin` prompts for an administrator username, email, and hidden password. Create this admin before testing the admin dashboard.

In the second terminal:

```powershell
cd .\sscs_frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. Keep both development servers running. Register an athlete and a Scout/Agency account in this React app to test its features. The Django admin user and Django data do not automatically appear in the React app.

## Quick start (PowerShell)

After the one-time setup above (including `npm install` in both folders and configuring `sscs_node/.env`), start the React frontend and Node API together from the project folder:

```powershell
.\start.ps1
```

The script opens a separate PowerShell window for each server. Open `http://localhost:5173` in your browser; close either server window to stop that server.

## Password recovery

Users can request an administrator-reviewed password reset from the sign-in page. Admins review requests in the dashboard and should independently verify the requester through a trusted channel before approving. Approval generates a one-time code that expires after 30 minutes; the admin shares it with the user outside SSCS, and the user sets a new password on the reset page. Regenerating a code invalidates the previous one and resets its failed-attempt counter. Five incorrect code attempts lock the code until an admin regenerates it. The admin dashboard records requests, approvals, declines, code activity, and completed resets. SSCS does not send reset emails.

## Proposal feature coverage

The React/Node application supports athlete and agency registration, login and role checks; administrator-reviewed password recovery; athlete profile editing with profile-photo uploads, competition level, multi-sport career history, performance information and external video links; scout athlete search by sport, position, age, competition level and location; private agency shortlists; direct messaging with user blocking and message/account reporting; responsive layouts; admin account activation and report review controls; and summary counts for athletes, agencies, shortlists and messages.

## Project completion and evaluation materials

- [Proposal requirements and evidence checklist](./evaluation/REQUIREMENTS-TRACEABILITY.md)
- [Research data-collection instrument drafts](./evaluation/RESEARCH-INSTRUMENTS.md)
- [Usability testing and SUS evaluation pack](./evaluation/USER-TESTING.md)
- [Final academic report structure](./docs/FINAL-REPORT-TEMPLATE.md)
- [Hosted demonstration deployment checklist](./docs/DEPLOYMENT-CHECKLIST.md)

These are working templates, not evidence that interviews, surveys, usability sessions, expert reviews, ethics approval, or deployment have occurred. Record only activities and results actually completed.

Athletes and scouts/agencies can upload, replace, or remove a profile photo from **My profile**. JPEG, PNG, and WebP images up to 3 MB are accepted and stored in the separate `sscs_api` PostgreSQL schema.

The application does not implement a dedicated mobile app, video hosting, AI recommendations, talent prediction, advanced performance analytics, or live match tracking, consistent with the proposal's stated delimitations.

## Worldwide Google Search

The agency directory embeds Google's Programmable Search Element to search the web. Google's Custom Search JSON API is closed to new customers, so this project uses the browser-embedded search instead; it does not require a Google Cloud API key.

1. Create or open your search engine at [programmablesearchengine.google.com](https://programmablesearchengine.google.com/) and configure it to search the entire web.
2. Copy its Search Engine ID (`cx`) into `sscs_frontend/.env`:

   ```dotenv
   VITE_GOOGLE_CSE_CX=your-search-engine-id
   ```

3. Restart the Vite frontend so it loads the new setting.

Google's search element runs in the browser and displays results according to the search engine configuration and Google's availability. SSCS local agency profiles remain available independently of Google Search. See Google's [Programmable Search Element documentation](https://developers.google.com/custom-search/docs/element) and [Custom Search JSON API availability notice](https://developers.google.com/custom-search/v1/overview).

## Backend API

The API is rooted at `/api`. `GET /api/health` checks the API and PostgreSQL connection. Authenticated endpoints enforce account roles; registration cannot create administrator accounts. The API stores only bcrypt password hashes and uses an HTTP-only session cookie.

While signed in, the app checks for unread messages every 15 seconds and when the browser tab regains focus. New incoming messages show an in-app alert and an unread count beside Inbox.

Sign-in and sign-out display a progress indicator for at least two seconds while the session request completes.

Athletes and Scout/Agency accounts can request a manual profile review. Administrators can approve or reject pending requests from the admin dashboard. Approved athlete and agency names display a blue verification tick, while the profile review panel retains its gold-star **Admin reviewed** badge. This means an SSCS administrator reviewed the submitted profile details; it is not an independent guarantee of sporting claims or agency standing. Editing profile fields clears the review so the updated details can be reviewed again. No verification documents are collected or stored.

Athlete profiles are discoverable by verified Scout/Agency accounts by default. Athletes can turn discovery off from **My profile**; they and administrators can still view a hidden profile. Athlete email addresses are not included in shared profile responses, and profile photos follow the same visibility rules as athlete profiles. New contact remains through SSCS messaging.

Athlete registration and profile editing offer a broad list of common sports and an **Other** option for any sport or discipline. Performance information remains flexible, so athletes can enter measures that fit their sport.

Users can block another account from the inbox. Blocking prevents new messages in both directions and removes the account from new-message recipient lookup; existing message history remains visible. Users can report an account or a message from their inbox. Administrators can mark reports resolved or dismiss them from the dashboard. Reports are reviewed manually and do not automatically suspend accounts.

## Login portals

Open `/login/` and select Athlete or Scout & Agency directly on the login form. Sign in with the email address used when registering and your password. The selected portal checks the account's database role before creating a session; using the other account type displays a message directing the user to the correct portal. Successful sign-in opens the matching role-specific dashboard and navigation menu. Dedicated `/login/athlete/` and `/login/scout/` URLs are also available. Administrators can use the administrator portal link on the login form. Account roles remain `athlete` and `scout` in the database.
