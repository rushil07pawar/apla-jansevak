# Municipal staff management

This add-on is an additive migration over the already-applied foundation. It does not create staff accounts or infer directory data. The six department names seeded by the migration are exactly the departments supplied for the project; no personnel, designations, reporting lines, ward grants, or complaint-routing rules are seeded.

## Existing implementation audited

The foundation contains `departments`, `wards`, `profiles`, `staff_profiles`, `staff_ward_assignments`, `complaints`, `complaint_assignments`, and `complaint_status_history`. Staff authentication uses Supabase Auth phone/password through the Express API. Staff profiles hold a department, unique Indian E.164 login mobile, role, active/approved flags, and a forced-password-change flag. The existing browser policies are read-only for staff and assignment records; there was no staff provisioning API, hierarchy, granular permission table, administrator audit log, or staff complaint work queue.

The original staff complaint-read policy allowed any approved staff member assigned to a matching department and ward. The add-on replaces it with explicit `complaints.read` grants scoped to both department and ward; a separately designated Main System Administrator is the only principal with cross-department complaint access.

## Additive schema

The migration adds:

- `departments.name_mr` for the supplied Marathi names.
- Bilingual name and designation fields, staff ID, official contact number, verification state, Main System Administrator marker, and update timestamp to `staff_profiles`. `mobile_e164` remains the unique Auth login identifier. No password is stored.
- `staff_hierarchy` for each staff member's optional reporting officer and department.
- `staff_permissions` for explicit complaint read, status-update, assignment, and escalation grants scoped to a department and ward.
- `admin_audit_logs` for staff profile, access, activation, and password-reset-request administration events.
- Event type, assignee references, and structured details on the existing `complaint_status_history` table.

The existing department, staff, and ward foreign keys remain in place. Hierarchy and permission records cascade when a staff profile is removed; audit actors are restricted from deletion so the audit trail is retained. Staff accounts should be deactivated rather than deleted.

## Authorization and policies

RLS stays enabled. No write policy is granted to `anon` or `authenticated` for hierarchy, permissions, audit logs, staff profiles, or ward assignments. Staff can read only their own profile, assignments, permissions, and directly connected hierarchy rows. A Main System Administrator can read audit logs; other users cannot.

Complaint and private-photo reads require the citizen owner or an active, approved staff member with no forced password change, an active assignment to the complaint ward, a matching staff department, and a matching `complaints.read` permission. A Main System Administrator is explicitly designated by `is_main_system_admin` and must also be active, approved, use the administrator role, and have completed password setup.

Staff complaint status, assignment, and escalation writes use service-only database functions. Each function verifies the actor and exact permission/department/ward scope, and writes the complaint history entry in the same transaction. Assignment targets must be active staff in the complaint's department and ward. Escalation targets must be the configured reporting officer and must be able to read that complaint's ward. Unrouted complaints can only be manually routed by the Main System Administrator; no category-to-department classifier or routing rule is invented. The browser never supplies a trusted actor ID; the server derives it from the verified Supabase Auth token. Notes entered as status updates are visible to the complaint owner.

Administrator endpoints verify both the Auth token and the database Main System Administrator record before using server-only Supabase credentials. Staff creation uses Supabase Auth Admin API with a random, undisclosed temporary credential and the trusted `account_type=staff` app-metadata marker. The database Auth trigger skips citizen-profile creation only for that server-assigned marker; public citizen sign-up cannot set app metadata. A phone recovery code is sent for staff to set their own password. No password is returned to or stored by the frontend.

## Apply and bootstrap order

1. Confirm that `20261031_001_supabase_foundation.sql` has already been applied. Do **not** rerun or replace it, and do not apply `20261105_002_staff_mobile_auth_PREPARE_ONLY.sql`.
2. Review and manually apply `database/migrations/20261106_003_staff_management.sql` in the Supabase SQL Editor. This repository does not apply SQL automatically.
3. Designate the first Main System Administrator explicitly. The migration deliberately grants this privilege to nobody. Use an existing Auth user whose Supabase Auth phone is already verified and matches a valid Indian E.164 number. First review the exact Auth user and department. Then run the following narrowly scoped bootstrap, replacing both placeholders only after verification:

   ```sql
   insert into public.staff_profiles (
     user_id, department_id, mobile_e164, official_contact_number,
     role, active, approved, force_password_change, is_main_system_admin
   )
   select
     u.id, d.id, u.phone, u.phone,
     'administrator', true, true, true, true
   from auth.users u
   join public.departments d on d.code = '<APPROVED_DEPARTMENT_CODE>'
   where u.id = '<VERIFIED_AUTH_USER_UUID>'::uuid
     and u.phone_confirmed_at is not null
     and u.phone ~ '^[+]91[6-9][0-9]{9}$'
     and not exists (
       select 1 from public.staff_profiles existing
       where existing.is_main_system_admin
     )
     and not exists (
       select 1 from public.staff_profiles existing
       where existing.user_id = u.id
     )
   returning user_id, department_id, mobile_e164, is_main_system_admin;
   ```

   The department is required by the existing staff profile relationship; the Main System Administrator marker provides cross-department access. Do not select a department arbitrarily. If the Auth user already has a staff profile, do not use this insert—review and promote that specific row in a separately reviewed SQL statement. If the query returns no row, stop and check the Auth phone verification, UUID, department code, and existing administrator/profile rows. Do not weaken the predicates.

4. The bootstrap sets `force_password_change=true`. At `/staff-login`, use that Auth user's mobile number and the **Forgot password?** flow to set a fresh password. This enables privileged endpoints only after recovery succeeds. Fill the administrator's official directory details from a verified source later; do not fabricate them.
5. Configure the Express server with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` in server-only deployment/local secret settings. Keep the secret key out of Vercel client variables and all `VITE_` variables. Set `CLIENT_ORIGIN` and `VITE_API_URL` for the respective deployments.
6. Deploy the Express API, then deploy the frontend. The frontend build remains in `client/`; the server is a separate service.
7. Test administrator provisioning, staff login/recovery, ward/department isolation, complaint actions, and private photo access in a non-production project before using the endpoints against production.

## Remaining source and operational inputs

- The hierarchy chart images were not present in the repository or request attachments available to this task. The directory page therefore starts with the six supplied department names and no staff entries. Add names, designations, reporting lines, and staff IDs only after the official charts are provided and an administrator verifies them.
- The first administrator's Auth UUID, verified phone, and department must be chosen by the system owner before bootstrap; none is selected by this migration.
- There is no configured complaint classification/routing rule or due-date/SLA source. Unrouted complaints need an administrator's manual department choice; no automated classification is performed. The dashboard does not invent an overdue threshold; overdue counts remain unavailable until an approved SLA source exists.
- Real Supabase Auth SMS, production RLS, and complaint transactions cannot be verified from a local build. They require a configured non-production Supabase project and approved test accounts.

## Local commands

```powershell
cd server; npm run dev
cd client; npm run dev
cd client; npm run build
```
