# AplaJansevak Main Administrator Setup — Handoff

This note summarizes the administrator setup work and the current failure state for another assistant or operator. It contains no credentials or personal account details.

## Goal

Create the application owner as the one global Main System Administrator, then sign in through the existing Municipal Staff Login page. The administrator must have no municipal department assignment (`department_id = NULL`) and must not be restricted to a ward.

## Existing implementation

- Frontend: React + Vite in `client/`.
- Backend: Express in `server/`, deployed separately from the Vercel frontend.
- Authentication and database: Supabase Auth and PostgreSQL.
- Setup page: `/admin-setup`; staff login: `/staff-login`; admin dashboard: `/admin-dashboard`.
- The setup API creates a Supabase Auth user using server-side credentials, sets trusted `app_metadata.account_type = 'staff'`, confirms the phone, then calls the service-role-only database function `public.bootstrap_main_system_administrator(uuid, text)`.
- That database function inserts the administrator profile and audit record. It requires a confirmed Indian phone, trusted staff app metadata, and no existing Main System Administrator. It assigns `role = 'administrator'`, `is_main_system_admin = true`, and `department_id = NULL`.
- The global administrator migration also contains database authorization and RLS changes. The setup procedure is documented in `docs/staff-management.md`.
- The intended migration order is foundation migration first, then migrations `20261106_003_staff_management.sql`, `20261106_004_admin_managed_staff_passwords.sql`, `20261106_005_staff_designations_and_roles.sql`, and `20261106_006_global_system_administrator.sql`. Verify what is already applied; do not blindly rerun migrations.

## What happened

1. The first administrator setup was attempted through `/admin-setup`, but the frontend displayed:
   > Unable to complete initial administrator setup. Check server configuration and database migrations, then contact the operator.
2. The user later reported deleting all users from the database. The exact scope and whether this means Supabase Auth users, application profile rows, or both has not been independently verified.
3. A read-only Supabase SQL query returned:
   - `bootstrap_function_installed = true`
   - `main_admin_count = 0`
4. Earlier live checks of the deployed Render API reported:
   - Express health endpoint: HTTP 200.
   - Supabase health endpoint: HTTP 200.
   - Administrator setup status: HTTP 200, setup available.
   - CORS preflight from `https://apla-jansevak.vercel.app`: HTTP 204 with the expected origin allowed.
5. After the latest setup attempt, the user checked Supabase Authentication → Users and reported that no Auth user was visible.
6. No detailed Render log fields were provided. The displayed generic error is not sufficient to determine the failing stage. It could have failed before Auth creation, or a deployed handler could have removed a just-created Auth user after profile bootstrap failed.
7. No administrator account was created by the assistant. No production SQL/migrations were executed by the assistant, and no deployment or push was performed by the assistant.

## Current diagnosis

The database bootstrap function exists and no Main System Administrator profile is currently reported by the provided query. Earlier checks showed that the backend could reach Supabase at that earlier time. These facts do **not** prove that the deployed registration endpoint can create an Auth user and call the bootstrap RPC successfully.

The exact cause remains unknown until the Render logs for the latest attempt are inspected. Useful non-secret diagnostic fields include:

- Registration stage (for example, Auth creation or staff-profile creation).
- HTTP status.
- Supabase/PostgREST error code and safe reason.
- Whether a new Auth user was created or preserved.

Never request or share passwords, setup keys, service-role keys, access tokens, email addresses, phone numbers, or full Auth user records in chat.

## Important safety notes

- Do not retry `/admin-setup` until the deployed backend failure is understood. Check Supabase Authentication → Users and related profile rows first to avoid creating a duplicate.
- Do not manually insert into `auth.users`, directly set an administrator role in Table Editor, disable RLS, or expose the Supabase service-role/secret key in frontend code.
- The database RPC is intentionally restricted to the service role; use the supported backend setup process.
- Since the user reports deleting all users, first establish exactly what was deleted and whether a backup/recovery is needed. Do not delete additional records or attempt a broad restoration without confirming the affected tables and taking an appropriate backup.
- Do not apply migrations in production without explicit approval. Confirm migration state and review dependencies before applying any pending migrations.
- If an Auth user is present but no administrator profile exists, preserve it and inspect its identity/profile state before repairing. Do not create another account or delete the existing one blindly.

## Recommended next steps

1. In Render Dashboard → the Express service → Logs, inspect the log event at the time of the latest setup attempt. Share only stage, status, safe error code/reason, and account-preservation outcome.
2. In Supabase, read-only inspect Authentication → Users and the relevant profile tables. First inspect actual table columns; do not disclose personal fields in the report.
3. Verify that migrations 003–006 are applied in the intended order and that the RPC signature/grant and required schema are present. The function-existence check alone does not verify all schema, grants, or deployed backend configuration.
4. Use the log evidence to fix the specific backend/database issue. Do not weaken RLS or add manual administrator SQL.
5. Only after the registration flow succeeds, verify the linked `staff_profiles` row, then sign in at `/staff-login` and verify redirect/access to `/admin-dashboard`.
6. Keep `/admin-setup` until a real administrator login has been verified. Remove the one-time setup key from the backend environment after successful setup.

## Prompt for another assistant

I need help diagnosing my AplaJansevak Main System Administrator setup. The app is React/Vite (`client/`), Express (`server/`), and Supabase Auth/PostgreSQL. The temporary setup page is `/admin-setup`; normal staff login is `/staff-login`.

The setup page returned: “Unable to complete initial administrator setup. Check server configuration and database migrations, then contact the operator.” A read-only Supabase query showed `bootstrap_function_installed = true` and `main_admin_count = 0`. Earlier checks showed Render Express health 200, Supabase health 200, setup status available, and Vercel CORS preflight 204. After the latest attempt, I checked Supabase Authentication → Users and did not see a user. I also reported that I deleted all users, but I have not established whether that means Auth users, profile rows, or both. I have not provided the matching Render logs, so the exact failure stage is unknown.

Please inspect the repository and give a safe, evidence-based diagnosis. Do not create/delete/promote accounts, run production SQL/migrations, disable RLS, deploy, or push. First tell me what safe Render log fields and read-only Supabase checks are needed. Do not ask me to paste passwords, setup keys, service-role keys, tokens, emails, phone numbers, or full user records. Preserve any existing account and avoid duplicates. The intended administrator profile is `role='administrator'`, `is_main_system_admin=true`, and `department_id=NULL`, created through the protected server-side bootstrap process.
