# SSCS Demonstration Deployment Checklist

The workspace currently documents local development. This checklist is for preparing a hosted demonstration; it does not mean deployment has occurred. Choose hosting that supports the Node.js API and PostgreSQL before filling in provider-specific steps. Do not put secret values in this file, source code, screenshots, or the final report.

## Render hosted demo

The root `render.yaml` defines one free Node web service that builds the React frontend and serves it from the Express API. Using one origin keeps the session cookie and API requests on the same host. The Blueprint intentionally does not create a database, so it does not choose a database plan or incur database costs automatically.

1. Push the project to a Git provider.
2. Create a Render Postgres database in the **Oregon** region, matching the Blueprint's web service region. Choose its plan deliberately: Render's [free Postgres databases expire after 30 days and do not include backups](https://render.com/docs/free#free-postgres). Do not use the free database for long-term or real participant data.
3. Create a Render Blueprint from the repository containing `render.yaml`. When prompted, use the database's **internal** host, database name, user, and password for `PGHOST`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`. Keep `PGPORT=5432`, `PGSSL=false`, and `PGSCHEMA=sscs_api`. The app and database should be in the same region.
4. Keep the generated `JWT_SECRET`. Render sets `RENDER_EXTERNAL_URL`; the API uses it as the allowed same-origin frontend URL. `VITE_API_URL` is intentionally unset so the built frontend calls `/api` on the same host.
5. Before sharing the app, create the first administrator from a trusted local terminal. In `sscs_node/.env`, temporarily use the database's **external** connection details and set `PGSSL=true`, then run `npm run create-admin` from `sscs_node`. The external database may need external access enabled in Render; restrict or disable external access again afterward. Restore the local `.env` and never commit or share the credentials.
6. Confirm the Render health check at `/api/health`, then complete the role journey and administrator smoke tests below.

The free web service spins down after inactivity, so its first request can be slow. The free Postgres database is temporary; choose a paid plan with backups for persistent data. A successful demonstration deployment is not proof of production readiness.

## Before deployment

- [ ] Confirm supervisor/institution requirements for hosting and public access.
- [ ] Choose hosting for the frontend/API and PostgreSQL; this Render Blueprint combines the frontend and API in one web service.
- [ ] Use a dedicated demo database, not a personal or production database.
- [ ] Create a strong, unique `JWT_SECRET` of at least 32 characters.
- [ ] Configure the backend environment variables from `sscs_node/.env.example`, including database connection details, schema, frontend origin, and session settings.
- [ ] If the frontend and API use separate hosts, configure `VITE_API_URL` and the API's allowed frontend origin to their exact HTTPS URLs. For the single-host Render Blueprint, leave `VITE_API_URL` unset.
- [ ] Ensure `.env` files and database credentials are excluded from version control and build artifacts.
- [ ] Use synthetic demo accounts and profiles. Do not seed real participant data or use participant accounts without approval.
- [ ] Confirm database backups, access controls, and a plan to remove demo data after the project.

## Build and smoke test

- [ ] Run `npm.cmd test` from `sscs_node/`.
- [ ] Run `npm.cmd run build` from `sscs_frontend/`.
- [ ] Apply the schema to the dedicated PostgreSQL database using the documented backend startup process.
- [ ] Create an administrator through the project's `create-admin` script; never enable public administrator registration.
- [ ] Confirm `GET /api/health` reports a connected database.
- [ ] Test athlete registration, login, profile edit, and logout.
- [ ] Test scout registration, search filters, profile view, shortlist add/remove, and logout.
- [ ] Test messaging and unread state between the two demo roles.
- [ ] Test administrator summary and account activation controls.
- [ ] Inspect desktop and narrow/mobile browser layouts.
- [ ] Verify HTTPS, cookie behavior, CORS/origin restrictions, and API error handling on the hosted URLs.
- [ ] Remove test accounts, database snapshots, and logs containing personal data when no longer needed.

## Deployment record

| Field | Entry |
|---|---|
| Frontend URL | |
| API base URL | |
| Hosting provider(s) | |
| Deployment date/version | |
| Database smoke test result/date | |
| Role journey smoke test result/date | |
| Known limitations | |

Do not claim production readiness based only on a demonstration deployment. Document hosting, uptime, backup, security, and data-retention limitations in the final report.
