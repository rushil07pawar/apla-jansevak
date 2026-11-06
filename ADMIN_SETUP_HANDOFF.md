# AplaJansevak Main System Administrator — Handoff

## Current design

- Frontend: React + Vite (`client/`); backend: Express (`server/`); identity/database: Supabase Auth and PostgreSQL.
- Administrator login is `/admin-login` and uses the existing Auth account's email and password.
- Initial promotion is at `/admin-register`. It requires an authenticated, confirmed Citizen account and a private setup key sent only to Express.
- Express verifies the bearer token with Supabase Auth and obtains the UUID from that verified response. The browser cannot choose the UUID, assign the role, or create an Auth user.
- A service-role-only RPC promotes the existing UUID to `staff_profiles` with `role='administrator'`, `is_main_system_admin=true`, `department_id=NULL`, `active=true`, and `approved=true`. It preserves the Auth account and Citizen profile.
- The database setup latch is independent of the administrator profile. Logout, deactivation, or Auth-user deletion does not reopen setup. A partial unique index and row-locked setup claim serialize promotions.
- The promoted identity is treated as staff by the Citizen identity guard. Citizen-only actions will therefore no longer be available to this account; other citizen and staff flows remain unchanged.

## Relevant local changes

- Migration 007 provides the permanent setup latch and atomic setup claim/release functions.
- Migration 008 makes contact/mobile optional for the global administrator and adds the Citizen-promotion RPC.
- `server/src/routes/staffAuth.js` contains token verification, promotion, setup status, administrator authorization, safe diagnostics, and unchanged mobile/password staff login.
- `client/src/lib/auth.js` and `client/src/App.jsx` contain the email/password administrator login and existing-account promotion UI.
- `docs/staff-management.md` contains related operations and API documentation.

Migrations 007 and 008 have **not** been run against production by the assistant. Check actual migration state and review dependencies before applying anything; do not rerun migrations blindly.

## Previous failure status

The earlier `/admin-setup` flow attempted Auth-user creation and showed a generic failure. The reported log contained only `stage=creating_auth_user`, `status=null`, and `cleanupFailed=false`; no detailed Render logs for that attempt were provided. That evidence is insufficient to identify whether the cause was request construction, network/DNS/TLS/timeout, configuration, or another failure. The current implementation does not create Auth users, so that old stage no longer applies.

Do not claim promotion succeeded until the linked profile and closed setup state are independently verified in Supabase. No promotion, production SQL/migration, deployment, or push was performed by the assistant.

## Safe operator steps

1. In Supabase, verify the existing account is email-confirmed and has its expected Citizen `profiles` row. Do not copy email addresses, tokens, credentials, or full Auth records into chat.
2. Verify migrations 003–007 and the relevant functions/indexes are present; review and apply migration 008 manually only after confirming the state and obtaining explicit approval.
3. Generate a new high-entropy setup key privately and set it as `ADMIN_SETUP_KEY` in the Express/Render environment. Never put it in a `VITE_` variable or commit it. The prior example contained a key-looking value and was replaced locally with a placeholder; rotate any corresponding real value if it was ever used or exposed.
4. Configure backend variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ADMIN_SETUP_KEY`, and `FRONTEND_URL`. The secret key and setup key belong only on the backend.
5. Configure frontend variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_URL`. These must not contain the service-role/secret key or setup key.
6. After separately approving migration and deployment, visit `/admin-register`, sign in with the existing Citizen email/password, and enter the private setup key. If the result is uncertain, check setup state and the linked profile before retrying.
7. Verify the same Auth UUID is linked to exactly one global administrator profile, with `department_id=NULL`, and setup is closed. Then sign in at `/admin-login` and confirm access to `/admin-dashboard`.
8. Remove `ADMIN_SETUP_KEY` from the backend environment after successful promotion. Any recovery must use a separate owner-authorized procedure; do not reset the latch or edit administrator roles directly.

## Diagnostics and safety

Render diagnostics may include the stage, failure category, HTTP status, safe Supabase error code/message, request/response indicators, and Supabase hostname/path. Never share passwords, setup keys, API keys, bearer/access/refresh tokens, email addresses, mobile numbers, request bodies, or full Auth responses.

Do not manually insert into `auth.users`, create a duplicate Auth user, edit the role in Table Editor, disable RLS, delete accounts/data, run production migrations, deploy, or push without explicit authorization.
