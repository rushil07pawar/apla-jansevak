# Supabase foundation migration runbook

The corrected [foundation migration](../database/migrations/20261031_001_supabase_foundation.sql) replaces the original, not-yet-applied foundation file. It is intended for a Supabase project with no AplaJansevak application tables in `public`. It does not drop tables, truncate data, delete Auth users, or create staff accounts. Do not run it until approved.

## Tables and relationships

| Table | Purpose and relationships |
|---|---|
| `departments` | Department lookup. Complaint and staff rows reference it. |
| `wards` | Active/inactive ward lookup. Ward 06 is seeded as `Ward 06` without claiming other official details. |
| `profiles` | One citizen profile per Auth user; `id` references `auth.users(id)` with cascade delete. Username is case-insensitively unique (`citext`). Existing name, username, phone, address, timestamp fields and checks are retained. |
| `staff_profiles` | One staff record per Auth user; `user_id` references `auth.users(id)` with cascade delete. `department_id` references `departments` with delete restricted. E.164 Indian mobile is unique. It contains role/approval controls but no password. |
| `staff_ward_assignments` | Many-to-many staff/ward authorization; composite primary key `(staff_user_id, ward_id)`, cascading with staff deletion, and restricts ward deletion. |
| `complaints` | Complaint owned by a `profiles` row; optional department; required ward. Citizen deletion is restricted, department deletion sets it null, and ward deletion is restricted. Photo paths use the existing `photo_path` field. |
| `complaint_assignments` | Complaint-to-staff assignment history, with `assigned_by` and `staff_user_id` both referencing staff profiles. Complaint deletion cascades; staff deletion is restricted. |
| `complaint_status_history` | Complaint status history; complaint deletion cascades, and deleted Auth users are nulled in `changed_by`. |

Indexes cover complaint ownership and department/ward access, ward assignment lookup, active complaint assignments, and complaint history.

## RLS policies

RLS is enabled on all eight public application tables. `anon` has no table grants or policies; authenticated users receive only the listed grants.

| Table | Policy and effect |
|---|---|
| `departments` | `read departments`: authenticated users may read department lookup data. |
| `wards` | `read active wards`: authenticated users may read active wards only. |
| `profiles` | `read own profile` and `update own profile`: users can read/update only the row whose id equals `auth.uid()`. Updates are limited to name, username, phone, and address columns. |
| `staff_profiles` | `read own staff record`: a user can read only their own staff row. No client insert/update/delete grants or policies. |
| `staff_ward_assignments` | `read own ward assignments`: a staff user can read only their own assignments. No client mutation grants or policies. |
| `complaints` | `citizen reads own complaints`: citizen ownership. `staff reads authorized complaints`: approved staff need both matching department and an active assigned ward; explicitly approved administrators are separately recognized by the helper. `citizen creates own submitted complaint`: ownership, no department assignment, submitted status, no initial photo path, and an active ward are required. `citizen updates own unassigned complaint`: only an owned, submitted, unassigned complaint in an active ward; column grants prevent changing owner, department, or status, and a linked photo path must use that citizen's id and complaint id. Staff receive read access only from the browser; complaint status changes require a trusted server/admin workflow. |
| `complaint_assignments` | `read own or authorized complaint assignments`: the assignee, owning citizen, or staff/admin authorized for the complaint may read it. No client mutation grants or policies. |
| `complaint_status_history` | `read own or authorized complaint history`: the owning citizen or staff/admin authorized for the complaint may read it. No client mutation grants or policies. |

The security-definer authorization helpers use a fixed empty `search_path`, are not executable by `anon`, and check the caller's Auth id. A staff member must be active, approved, not forced to change a password, assigned to the complaint's active ward, and in its department. An administrator must have an `administrator` staff profile that is active, approved, and not forced to change a password; this is the explicit all-ward complaint authorization path.

There are no browser policies to create or alter staff profiles, department membership, ward assignments, complaint assignments, complaint status, or status history. Provisioning and workflow writes must go through a trusted, server-side process that independently verifies the administrator. RLS is still enforced for normal publishable-key requests; a service-role key bypasses RLS and must never be shipped to a browser.

## Auth trigger and registration errors

`on_auth_user_created` requires string metadata values for `full_name`, `username`, `phone`, and `residential_address`. It trims the values, lowercases the username, validates all four against the retained field constraints, then inserts exactly one profile for the new Auth id. The primary key prevents a second profile; the case-insensitive unique constraint prevents duplicate usernames, including concurrent registrations. A username collision or any metadata/profile error is raised, not swallowed. Because the trigger runs in the Auth insert transaction, the Auth insert rolls back as well; this avoids an Auth account without its required profile.

The browser sends these fields as Auth `options.data`. A trigger failure makes `auth.signUp` return a non-null `error` (GoTrue may present a database-trigger failure as a generic Auth error rather than exposing the SQL message). The existing `registerCitizen` helper throws that error, so the UI must show a safe registration failure/validation message and must not report success unless `error` is null.

The trigger applies to every new Auth user, including staff provisioned through Auth. Therefore the authorized staff-provisioning process must also provide valid profile metadata (including a unique username) when it calls Supabase Auth. Staff mobile sign-in still uses the Auth phone/password flow; the staff profile stores only the unique mobile identifier and authorization state, never the password.

## Preserve and repair an existing Auth user

The trigger does not run retroactively for existing Auth rows. The migration does not delete or recreate them. Before migration, record the existing user's Auth UUID and ensure the project has its usual recovery/backup safeguards. After migration:

1. Keep the existing Auth row, UUID, login identifier, and password unchanged. If its user metadata is missing or invalid, update only `user_metadata` through the trusted Supabase Auth Admin API with valid values for the four required keys.
2. Verify the normalized username is not already in use.
3. Insert the matching profile with the **same existing Auth UUID**. Do not use `ON CONFLICT DO NOTHING`, delete/recreate the Auth user, or alter the Auth UUID. A uniqueness or check failure must be corrected and retried explicitly.

Example for a reviewed existing user, after the metadata is valid:

```sql
insert into public.profiles (id, full_name, username, phone, residential_address)
values (
  'REPLACE_WITH_EXISTING_AUTH_UUID'::uuid,
  'REPLACE_WITH_VERIFIED_FULL_NAME',
  lower('REPLACE_WITH_UNIQUE_USERNAME'),
  'REPLACE_WITH_E164_PHONE',
  'REPLACE_WITH_VERIFIED_RESIDENTIAL_ADDRESS'
);
```

The placeholder values must be replaced with verified values satisfying the migration's constraints. This insert is a separate profile repair; a failure does not delete or change the pre-existing Auth user.

## Exact Supabase application order

1. Confirm the Dashboard is connected to the intended Supabase project. Verify that `public` has no AplaJansevak application tables and record the existing Auth user's UUID. Do not delete the Auth user. The migration adds restrictive guards for `complaint-photos` because PostgreSQL permissive storage policies otherwise combine with OR semantics.
2. Ensure the project has the required Supabase Auth configuration. Staff phone/password login requires Phone Auth and a compliant SMS provider; provision staff only through an authorized server/admin process. Do not expose the service-role/secret key in frontend code.
3. Open **Supabase Dashboard → SQL Editor**, review the entire corrected foundation migration, and run that one file once. Do not run the old foundation contents separately, and do not run `20261105_002_staff_mobile_auth_PREPARE_ONLY.sql`; it is not part of this migration sequence.
4. If the project already has an Auth user, repair its profile as described above after the schema and trigger have been created. The Auth user itself is preserved.
5. Add only verified department records through an authorized process. Ward 06 is already seeded as the pilot designation. Provision staff Auth users with the required metadata first, then create their staff profiles and ward assignments through a trusted administrator workflow. Grant approval only after verification.
6. Verify tables, grants, RLS policies, helper-function privileges, and the private bucket using read-only checks. In a non-production project, test citizen isolation, department-plus-ward access, administrator access, assignment restrictions, and photo upload/read/delete rules before enabling complaint workflows.

No SQL is executed by the application. Do not apply the staff mobile PREPARE_ONLY migration automatically or as part of this sequence.

## Private complaint photos

`complaint-photos` remains private, limited to 5 MiB and JPEG, PNG, or WebP. A citizen can upload only under `<auth-uuid>/<complaint-uuid>/<filename>` for their own complaint. Reads require a photo path linked to a complaint and either citizen ownership or staff/admin complaint authorization. Deletion is limited to the owner's unlinked photo. Anonymous access and photo updates are denied; restrictive guards prevent other permissive storage policies from broadening the rules, while leaving other buckets' policies unchanged. Use authenticated downloads or short-lived signed URLs only after authorization.
