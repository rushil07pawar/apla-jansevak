# Staff mobile authentication (prepared, not applied)

The staff route now sends the registered mobile number and password to the server endpoint `POST /api/staff-auth/login`. The endpoint normalizes accepted Indian numbers to `+91` plus a 10-digit number beginning 6–9, submits the password to Supabase Auth using its native phone/password flow, and then checks the corresponding `staff_profiles` row with a server-only secret. The browser never queries `staff_profiles` during staff sign-in.

## Required Supabase configuration

1. Enable Phone Auth and configure a production SMS provider compliant with applicable Indian TRAI/DLT requirements.
2. Enable CAPTCHA and set Auth rate limits. Enable MFA for staff: phone numbers can be recycled and are not sufficient protection by themselves.
3. Configure the SMS provider and the staff recovery UI to collect the OTP and new password. The backend provides `POST /api/staff-auth/recovery/complete`, which verifies the OTP, re-checks active/approved staff status, updates the Auth password, and clears the temporary-password flag.
4. Store `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` only in the backend deployment secrets. `SUPABASE_SECRET_KEY` (or legacy service-role key) must never use a `VITE_` name or appear in browser code.
5. Review and manually apply `20261105_002_staff_mobile_auth_PREPARE_ONLY.sql` in a non-production project. Backfill only administrator-verified staff phone numbers, set approved accounts to `approved = true`, and retain `force_password_change = true` until the temporary password is changed.

## Administrator workflow

An authorized administrator, through a protected server/admin process, creates the Auth user with `phone`, a one-time temporary password, and `phone_confirm: true`; creates the matching staff profile with the identical normalized `mobile_e164`, role, department, approval, and active state; then delivers the temporary password through a separate approved channel. Do not store passwords in database tables.

Password recovery must prove possession of the registered phone via OTP, verify that the account is active and approved, then allow a password update and clear `force_password_change` through a trusted server workflow. The current code deliberately does not auto-create users or reveal whether a mobile number exists. Connect the supplied completion endpoint to a dedicated recovery screen before launch.

## Test plan (non-production only)

Create only disposable administrator-provisioned accounts. Test: valid staff sign-in; malformed mobile input; wrong password; inactive and unapproved staff; citizen credentials submitted to staff login; rate-limit response; forced temporary-password change; OTP recovery; and direct dashboard/API access with a citizen token, inactive staff token, and staff token from another department/ward. Do not treat the UI message as authorization: verify each case against RLS-protected dashboard queries.
