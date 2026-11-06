# Municipal staff management

This add-on is an additive migration over the already-applied foundation. It does not create staff accounts or infer directory data. The six department names seeded by the migration are exactly the departments supplied for the project; no personnel, designations, reporting lines, ward grants, or complaint-routing rules are seeded.

## Existing implementation audited

The foundation contains `departments`, `wards`, `profiles`, `staff_profiles`, `staff_ward_assignments`, `complaints`, `complaint_assignments`, and `complaint_status_history`. Staff authentication uses Supabase Auth phone/password through the Express API. Ordinary staff profiles hold a department, unique Indian E.164 login mobile, role, active/approved flags, and a forced-password-change flag. Migration 006 permits a null department only for the database-designated Main System Administrator.

The original staff complaint-read policy allowed any approved staff member assigned to a matching department and ward. The add-on replaces it with explicit `complaints.read` grants scoped to both department and ward; a separately designated Main System Administrator is the only principal with cross-department complaint access.

## Additive schema

The migration adds:

- `departments.name_mr` for the supplied Marathi names.
- Bilingual name and designation fields, staff ID, official contact number, verification state, Main System Administrator marker, and update timestamp to `staff_profiles`. `mobile_e164` remains the unique Auth login identifier. No password is stored.
- `staff_hierarchy` for each staff member's optional reporting officer and department.
- `staff_permissions` for explicit complaint read, status-update, assignment, and escalation grants scoped to a department and ward.
- `staff_designations` for bilingual, department-specific designation choices managed by the Main System Administrator. New staff profiles link to one active designation; older profiles can retain their existing free-text designation until the administrator maps them.
- `admin_audit_logs` for staff profile, access, activation, and administrator-managed password changes.
- Event type, assignee references, and structured details on the existing `complaint_status_history` table.
- `20261106_006_global_system_administrator.sql` permits a department-independent Main System Administrator, adds audited department and generic system-setting management, and grants that administrator read access to global staff and ward records. Ordinary staff still require a department and explicit ward-scoped grants.

The existing department, staff, and ward foreign keys remain in place. Only a Main System Administrator may have a null `staff_profiles.department_id`; ordinary staff still require a department. The global administrator receives all-department and all-ward authorization from the database administrator predicate, not synthetic assignment rows. Its free-text designation is `Developer / Main System Administrator`; it is not linked to a department-scoped designation. Hierarchy and permission records cascade when a staff profile is removed; audit actors are restricted from deletion so the audit trail is retained. Staff accounts should be deactivated rather than deleted.

## Authorization and policies

RLS stays enabled. No write policy is granted to `anon` or `authenticated` for hierarchy, permissions, audit logs, staff profiles, ward assignments, or system settings. Ordinary staff can read only their own profile, assignments, permissions, and directly connected hierarchy rows. A Main System Administrator can read all staff and ward data, system settings, and audit logs; other users cannot. Department and system-setting changes use service-role-only database functions that verify the actor against the database Main System Administrator profile and write audit events.

Complaint and private-photo reads require the citizen owner or an active, approved staff member with no forced password change, an active assignment to the complaint ward, a matching staff department, and a matching `complaints.read` permission. A Main System Administrator is explicitly designated by `is_main_system_admin` and must also be active, approved, use the administrator role, and have completed password setup.

Staff complaint status, assignment, and escalation writes use service-only database functions. Each function verifies the actor and exact permission/department/ward scope, and writes the complaint history entry in the same transaction. Assignment targets must be active staff in the complaint's department and ward. Escalation targets must be the configured reporting officer and must be able to read that complaint's ward. Unrouted complaints can only be manually routed by the Main System Administrator; no category-to-department classifier or routing rule is invented. The browser never supplies a trusted actor ID; the server derives it from the verified Supabase Auth token. Notes entered as status updates are visible to the complaint owner.

Administrator endpoints verify both the Auth token and the database Main System Administrator record before using server-only Supabase credentials. Staff creation uses Supabase Auth Admin API with the administrator-supplied password and the trusted `account_type=staff` app-metadata marker. The database Auth trigger skips citizen-profile creation only for that server-assigned marker; public citizen sign-up cannot set app metadata. The server marks staff Auth phones as confirmed administratively; it sends no SMS or email verification. Passwords are never stored in application tables or returned by the API. Administrators can set a new password for an existing staff account; the change is recorded in the audit log.

## Apply and bootstrap order

1. Confirm that `20261031_001_supabase_foundation.sql` has already been applied. Do **not** rerun or replace it, and do not apply `20261105_002_staff_mobile_auth_PREPARE_ONLY.sql`.
2. Review and manually apply `database/migrations/20261106_003_staff_management.sql`, `database/migrations/20261106_004_admin_managed_staff_passwords.sql`, `database/migrations/20261106_005_staff_designations_and_roles.sql`, and `database/migrations/20261106_006_global_system_administrator.sql` in the Supabase SQL Editor. Apply them in that order. This repository does not apply SQL automatically or modify existing staff/citizen rows as part of migration 006.
3. Configure the Express server with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` in server-only local/deployment secret settings. Keep the secret key out of Vercel client variables and all `VITE_` variables.
4. For browser-based initial setup, generate a random key with at least 32 characters and configure it as `ADMIN_SETUP_KEY` only in the Express host's private environment settings. The legacy `MAIN_ADMIN_SETUP_KEY` is accepted temporarily. Do not configure either key in Vercel or a `VITE_` variable. Set Vercel's build-time `VITE_API_URL` to the HTTPS origin of the Express service, without `/api`, and redeploy the frontend.
5. Once migrations 003–006 are applied and the backend is deployed, open `https://<your-vercel-domain>/admin-setup`. Enter the setup key directly into the form; it is sent only in the HTTPS request body. The backend checks that no Main System Administrator exists, rate-limits attempts, creates a phone- and email-confirmed Supabase Auth user with server-set `app_metadata.account_type=staff`, and calls the service-role-only `bootstrap_main_system_administrator` RPC. The RPC and unique database index enforce one administrator transactionally and record an audit event. The profile uses `department_id = NULL`, `role = 'administrator'`, `is_main_system_admin = true`, and the developer designation. Username is descriptive Auth user metadata; it is not used for authorization. No passwords or setup keys are logged or stored in application tables.
6. If the email/mobile is already registered, setup will not reuse or promote that identity. If profile bootstrap fails or its result is uncertain after a new Auth user is created, the endpoint preserves that Auth user. Have the deployment operator inspect it and its profile before any retry; do not delete or duplicate the account blindly. Once the administrator exists, the API reports setup closed even if the form URL is revisited.
7. After registration, remove `ADMIN_SETUP_KEY` (and any legacy `MAIN_ADMIN_SETUP_KEY`) from the Express host environment and redeploy/restart the API. Then sign in at `/staff-login` with the registered 10-digit mobile and password. A verified Main System Administrator is redirected to `/admin-dashboard`; that page and all administrator APIs re-check the Auth token and database profile. Confirm successful login before removing the temporary `/admin-setup` route in a follow-up code change. The administrator receives global access through its database profile, not synthetic ward assignment rows.
8. The existing terminal alternative is `npm --prefix server run setup:main-admin`; it prompts for full name, mobile, and a hidden password. It uses the same service-role-only bootstrap RPC and does not create a duplicate profile.
9. Use **System settings** in staff management for non-secret JSON configuration. Do not store passwords, API keys, or other secrets in this table. Department and system-setting changes are audit-logged. Keep credentials out of chat and application tables.
10. Verify tables, grants, RLS policies, helper-function privileges, and the private bucket using read-only checks. In a non-production project, test citizen isolation, department/ward permission scopes, global Main System Administrator access, assignment restrictions, and photo upload/read/delete rules before enabling complaint workflows.
11. Deploy the Express API, then deploy the frontend. The frontend build remains in `client/`; the server is a separate service.
12. Test administrator provisioning, 10-digit phone/password login, administrator password changes, role/ward/department isolation, complaint actions, and private photo access in a non-production project before using the endpoints against production.

Auth creation failures are logged server-side with the setup stage, failure category, exception/cause, whether fetch was invoked, whether an HTTP response arrived, HTTP status, Supabase error code/message when returned, and only the Supabase hostname and API path. User-submitted identifiers and credentials, setup keys, request bodies, authorization headers, and Auth responses must not be logged. A null HTTP status means no HTTP response was received; use the sanitized exception and failure category to distinguish request construction, DNS, TLS, timeout, or other network failures.

**No-verification tradeoff:** one-time setup uses the server-held key as its authorization and marks the entered phone/email confirmed without an SMS or email challenge. Enter only contact details that you control, protect the key, and remove it from the Express host after the administrator is created.

## Remaining source and operational inputs

- The hierarchy chart images were not present in the repository or request attachments available to this task. The directory page therefore starts with the six supplied department names and no staff entries. Add names, designations, reporting lines, and staff IDs only after the official charts are provided and an administrator verifies them.
- The developer enters their own full name, 10-digit mobile, email, password, and setup key only in the secured setup page or trusted terminal. Never paste them into chat. The Main System Administrator does not belong to a municipal department and receives global authorization without ward-assignment rows.
- There is no configured complaint classification/routing rule or due-date/SLA source. Unrouted complaints need an administrator's manual department choice; no automated classification is performed. The dashboard does not invent an overdue threshold; overdue counts remain unavailable until an approved SLA source exists.
- Real Supabase Auth SMS, production RLS, and complaint transactions cannot be verified from a local build. They require a configured non-production Supabase project and approved test accounts.

## Local commands

```powershell
cd server; npm run dev
cd client; npm run dev
cd client; npm run build
```
