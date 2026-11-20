# SSCS Proposal Requirements and Evidence Checklist

This checklist compares the proposal with the current workspace. "Implemented" means implementation evidence is present in the code; it does not mean the feature has been accepted by users or deployed. Update the evidence and status after each real test or review.

| Proposal requirement | Current evidence | Status / remaining evidence |
|---|---|---|
| React front end, Node.js/Express API, PostgreSQL database | React/Vite, Express API, PostgreSQL schema documented in the README and source | Implemented; verify against the configured PostgreSQL instance before demonstration |
| Relational data model for accounts, athlete and agency profiles, shortlists, and messages | `sscs_node/src/schema.sql` | Implemented; include the final ER diagram/data dictionary in the report |
| Athlete and agency/scout registration and authentication | Registration, login, role checks and session endpoints in `sscs_node/src/app.js` | Implemented; demonstrate both roles and report functional test results |
| Athlete profiles with sport, position/event, age, competition level, location, bio, career history, performance information, and video links | Schema, validation and profile screens in the Node and React projects; registration and profile editing provide a labeled sport-specific performance-data editor with context for scouts | Implemented; frontend build and browser checks for entry and duplicate-name handling passed. Still test profile save/reload and representative multi-sport data |
| Supporting materials | Profile photo upload and external video URL support | Implemented with limits; proposal does not require video hosting. Verify upload and links during a real demo |
| Agency profiles | Agency profile schema, API and directory | Implemented; verify representative agency data and contact flow |
| Search by sport, position, age, competition level and geographical location | Athlete search API and search page | Implemented; test each filter and combinations, and record results |
| Review and shortlist potential recruits | Athlete profile and shortlist API/pages | Implemented; verify add, duplicate add, display and removal |
| Communication between users | Messages and inbox endpoints/pages | Implemented; test sender/recipient roles, unread state, and message display |
| Administrator management and basic reports | Admin user controls, summary counts, and a live pending-approval count with an actionable dashboard alert; pending accounts are sorted first in the review table | Implemented; frontend build and API tests confirm counts increase on submission and clear after approval. Verify account activation/deactivation and live polling in a deployed admin session |
| Responsive web application | Responsive styles are present in `sscs_frontend/src/style.css` | Implemented in code; still manually inspect supported desktop and mobile browser widths |
| Figma wireframes/prototypes before implementation | No Figma artifact was found in the workspace | Not evidenced; add the actual design file/export if one exists, or document this as not completed/changed |
| Functional testing | 15 Node tests pass; frontend production build succeeds | Partial evidence; add test results for actual PostgreSQL operation and end-to-end role journeys |
| Demonstration to selected athletes and agency representatives | No completed demonstration records found | Must be performed and documented; do not mark as complete until it occurs |
| Interviews and athlete questionnaire | Draft interview guide and questionnaire appear in proposal appendices | Instruments drafted; collect and analyze actual data, with required approval and consent |
| Usability testing and SUS | A blank instrument is in `evaluation/USER-TESTING.md` | Must conduct sessions, record task outcomes, and calculate scores from actual responses |
| Two IT expert reviews | Blank review checklist is in `evaluation/USER-TESTING.md` | Must invite experts, collect their independent findings, and document resulting changes |
| Final report and communication of findings | Proposal document is present; no final report was found | Not evidenced; complete the report using `docs/FINAL-REPORT-TEMPLATE.md` |
| Working demo deployment | Local startup instructions are present in the README | Local run path exists; no deployed demo URL or hosting evidence found |
| Data protection and research ethics | Authentication, role controls and research ethics statements appear in the proposal | Technical measures are partly implemented; secure institutional approval and informed consent before primary research |
| Proposal delimitations: no native app, video hosting, AI recommendations, prediction, advanced analytics, or live match analysis | README describes these as out of scope | Correctly excluded; do not count as missing features |

## Test evidence currently recorded

- Backend: run `npm.cmd test` from `sscs_node/`.
- Frontend production build: run `npm.cmd run build` from `sscs_frontend/`.
- Last observed workspace check (2026-11-18): 18 backend tests passed and the frontend production build succeeded.

## Completion record

| Item | Entry |
|---|---|
| Checklist last reviewed | |
| Reviewer | |
| PostgreSQL smoke test date/result | |
| Athlete journey test date/result | |
| Scout/agency journey test date/result | |
| Mobile-width check date/result | |
| Deployed demo URL (if deployed) | |
