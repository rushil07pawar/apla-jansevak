# Municipal staff mobile authentication

Staff enter exactly 10 digits (without `+91`) and a password. The server normalizes the number to `+91` plus those digits for Supabase Auth and stores that single normalized format in `staff_profiles`. It verifies the matching active and approved staff profile, an active ward assignment and `complaints.read` scope (unless the user is the Main System Administrator), and returns department, designation, authorized wards, permissions, and reporting officer. Citizens and inactive, unapproved, or unassigned accounts are rejected. No SMS or email verification is part of staff sign-in. Public staff registration is not available.

## Required Supabase and server configuration

1. Enable Supabase Phone Auth for password-based sign-in. Staff accounts are created through the Admin API with the phone marked confirmed; no OTP is sent.
2. Configure Auth password rules and rate limits. Consider MFA for administrators. Phone numbers can be mistyped or recycled, so verify staff identity and number through municipal procedures before creating the account.
3. Store `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` only in backend deployment secrets. A legacy service-role key may be accepted server-side, but must never appear in browser code or any `VITE_` variable.
4. Apply the foundation migration, then the [staff management migration](../database/migrations/20261106_003_staff_management.sql), [admin-managed staff passwords](../database/migrations/20261106_004_admin_managed_staff_passwords.sql), and [staff designations and roles](../database/migrations/20261106_005_staff_designations_and_roles.sql). Do not apply `20261105_002_staff_mobile_auth_PREPARE_ONLY.sql`.

## Account provisioning and passwords

Only the designated Main System Administrator can create staff accounts through the protected `/api/admin/staff` endpoint. The administrator enters a unique mobile username and a password of 12–128 characters. Supabase Auth stores the password securely; the application does not put passwords in `staff_profiles`, return them from the API, or log request bodies. The administrator must share the password with the staff member through a secure channel. The **Set password** action lets the administrator change a staff password later and records that change in the audit log.

The server creates staff Auth users with the trusted `app_metadata.account_type = 'staff'` marker. The database trigger skips citizen-profile creation only for those server-created accounts. Public sign-up cannot set Auth app metadata. Existing Auth users are preserved; the first Main System Administrator must be explicitly bootstrapped by a project owner as described in [staff-management.md](staff-management.md).

No verification means Supabase does not prove that the account holder controls the entered phone number. Only provision staff after an administrator has independently confirmed the staff member's identity and assigned mobile number. Use HTTPS for the deployed API, keep service credentials server-side, and never send passwords in chat. The staff login has no self-service OTP reset; a verified Main System Administrator must set a new password through Staff Management.

## Authorization and testing

Server endpoints verify the bearer token against Supabase Auth and check the database's Main System Administrator or active staff record. Complaint access additionally requires the staff member's department, active ward assignment, and explicit scoped permissions; RLS and service-only database functions enforce these checks. A frontend role, department, ward, or actor ID is not treated as an authorization source.

Test only with disposable accounts in a non-production project: valid/invalid phone/password sign-in, citizen credentials at the staff endpoint, inactive/unapproved accounts, administrator-only account creation and password changes, ward/department isolation, permissions, status updates, assignment/escalation history, and private photo access. Do not rely on the UI's role checks as a substitute for RLS tests.
