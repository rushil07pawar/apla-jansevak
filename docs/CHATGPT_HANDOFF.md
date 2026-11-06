# AplaJansevak handoff for the next ChatGPT session

Updated: 2026-11-06

This note summarizes the project work and current reported database/login state. Treat the production database state as unverified until checked directly in Supabase. Do not apply, rerun, repair, or roll back SQL without first confirming the current schema and getting the project owner's approval.

## Project overview

AplaJansevak is a React/Vite citizen application backed by Supabase, with a separate Express server for municipal staff authentication and protected staff-management operations. The Vercel frontend project is rooted at `client/`; the server is a separate deployment. The Supabase secret/service-role credential must remain server-side.

## Work completed in the repository

### Citizen application

- Preserved the citizen email/password authentication and Supabase integration.
- Implemented the citizen-first homepage, protected complaint form and complaint tracking routes.
- The complaint form supports category, description, required image, and browser location capture. Do not claim a live complaint workflow has been verified unless tested against the deployed schema and policies.
- Citizen authentication/profile checks and redirects were implemented previously. The user now reports that citizen sign-in is failing after database SQL was run; this failure has not yet been diagnosed.

### Database migrations

- `database/migrations/20261031_001_supabase_foundation.sql` is the foundation migration for citizen profiles, staff profiles, departments, wards, complaints, complaint history/assignments, RLS policies, and private complaint-photo storage.
- `database/migrations/20261105_002_staff_mobile_auth_PREPARE_ONLY.sql` is explicitly marked historical/PREPARE ONLY and says not to apply it alongside the corrected foundation. It adds/redefines mobile-related fields/helpers and is not part of the migration sequence.
- `database/migrations/20261106_003_staff_management.sql` is an additive staff hierarchy, scoped permissions, audit, and complaint workflow migration. It seeds the six supplied department names but does not create staff accounts or a Main System Administrator.
- `database/migrations/20261106_004_admin_managed_staff_passwords.sql` is an additive helper for administrator-managed staff passwords and audit.
- Recommended sequence when starting from a valid foundation: foundation once, then 003, 004, and 005. Do not apply 002.
- Migration files have not been executed by the coding assistant. SQL behavior, live RLS, and actual Supabase state are not verified.

### Staff management and authentication implementation

- Added the administrator department/staff management UI and a ward/department-scoped staff complaint dashboard.
- Added protected Express APIs for administrator staff management and staff complaint work.
- Staff accounts are provisioned by an authorized Main System Administrator. No public staff registration exists.
- Most recent local implementation uses a mobile number in Supabase Auth's `phone` field as staff login identifier. The administrator sets a 12–128 character password through the server-side Supabase Auth Admin API. No OTP is sent by this provisioning/login flow.
- The UI accepts exactly ten digits without a `+91` prefix; the server normalizes to `+91` plus the ten digits for Supabase Auth.
- New accounts are limited to Department Head, Supervising Officer, Junior/Section Officer, or Assigned Municipal Staff. Legacy/admin roles cannot be assigned to a new account through the UI or create API.
- Migration `20261106_005_staff_designations_and_roles.sql` adds the designation catalog and requested role values. It has not been applied.
- Supabase Auth remains the password authority. The application does not store staff passwords in `staff_profiles`.
- Admin-managed password changes are audited via the helper in migration 004.
- The first Main System Administrator is not created automatically. The documented bootstrap is in `docs/staff-management.md`.

### Local validation already performed

- `client`: `npm run build` succeeded; Vite emitted a JavaScript chunk-size warning above 500 kB.
- `client`: `npm run lint` passed.
- Server JavaScript syntax checks and `git diff --check` passed.
- A mocked staff provision/password-reset test passed and confirmed the tested code path did not send OTP/verification requests. This was not a live Supabase test.
- No migration was executed, no account was created, and nothing was pushed or deployed by the assistant.

## User-reported production/database problem — unresolved

The user reports:

- They ran `20261105_002_staff_mobile_auth_PREPARE_ONLY.sql` after running migration 004.
- They cannot sign in as a citizen or as any staff member.
- When they ran SQL, Supabase showed: `ERROR: 42P07: relation "departments" already exists`.
- Their Supabase Table Editor screenshot shows tables including `departments`, `staff_profiles`, `staff_hierarchy`, `staff_permissions`, and `admin_audit_logs`.

Important diagnosis limits:

- `42P07 relation "departments" already exists` indicates a query attempted to create a table that already exists—likely the foundation SQL was run again or included in the pasted query. Migration 002 itself does not create `departments`.
- The existence of tables does not prove which migrations completed or whether they were applied in the intended order. A failed SQL Editor query may have rolled back its transaction, but this must not be assumed without checking.
- Migration 002 is not the recommended migration and should not be rerun. Do not drop tables, delete Auth users, or rerun the foundation to troubleshoot.
- It is not established that migration 002 caused either login failure. Its contents do not recreate `departments` or directly change the citizen email/password login flow. Diagnose exact Auth/API/browser error messages and inspect schema, Auth settings, trigger state, and applied SQL before attributing cause.
- Do not ask the user to paste passwords, OTP codes, anon/secret keys, or other credentials. Never expose a Supabase secret key.

### Safe diagnostic sequence for the next session

1. Ask the user for the exact citizen and staff login error text (redact tokens and personal data) and whether the SQL Editor reports the full query as failed or successful.
2. Confirm which project/environment the browser and SQL Editor are using; do not assume production or local are aligned.
3. Use read-only SQL/catalog checks to establish whether migrations 001, 003, and 004 are fully present: tables, columns, functions, triggers, policies, and storage bucket. Do not rerun an entire migration as a probe.
4. Inspect the Auth logs and server/browser network error status for the failed login. Citizen login uses email/password; staff login currently uses the Auth phone/password flow.
5. Identify a narrowly scoped, reviewed repair only after the actual failure cause is known. Preserve all Auth users and complaint data.

## Current staff authentication requirement

The current requirement is staff login with a registered Indian mobile number (10 digits in the UI) and a password, not a username-only login. The mobile number is normalized server-side and used with Supabase Auth. No OTP is sent by the implemented provisioning/login flow. Because this does not prove phone ownership, administrators must independently verify staff identity before provisioning. Citizen authentication remains email/password and separate from staff access.

## Key files

- `client/src/App.jsx` — citizen/staff routes and staff/administrator UI.
- `client/src/lib/auth.js` — citizen and staff sign-in client functions.
- `client/src/lib/staffManagement.js` — frontend client for protected staff APIs.
- `server/src/routes/staffAuth.js` — staff login endpoint.
- `server/src/lib/staffAuth.js` — current phone normalization, Supabase password login, and authorization checks.
- `server/src/routes/staffManagement.js` — administrator management endpoints.
- `server/src/lib/staffManagement.js` — server-side account creation and password management.
- `database/migrations/20261031_001_supabase_foundation.sql` — foundation schema/RLS/Auth trigger.
- `database/migrations/20261105_002_staff_mobile_auth_PREPARE_ONLY.sql` — historical PREPARE ONLY; do not apply.
- `database/migrations/20261106_003_staff_management.sql` — additive staff management migration.
- `database/migrations/20261106_004_admin_managed_staff_passwords.sql` — additive password/audit helper.
- `database/migrations/20261106_005_staff_designations_and_roles.sql` — unapplied designation and role migration.
- `docs/staff-management.md` — bootstrap and staff-management instructions.
- `docs/staff-mobile-auth.md` — current phone/password design; update it if username authentication is redesigned.
- `docs/database-migration-runbook.md` — migration sequence and operational guidance.

## Scope for the next session

1. First diagnose and safely restore the reported citizen and staff login issues without destructive database changes.
2. Confirm which migrations actually succeeded; do not run migration 002 again or apply 005 until the existing state is confirmed and approved.
3. Preserve citizen email/password authentication, RLS, department/ward authorization, audit logging, and server-only secret handling.
4. Test locally and, only with approval, in a non-production Supabase project. Do not claim production behavior is fixed until it is tested.
