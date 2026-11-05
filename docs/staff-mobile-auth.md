# Municipal staff mobile authentication

Staff sign in with their registered Indian mobile number and a password managed by Supabase Auth. The client sends credentials to `POST /api/staff-auth/login`; the Express server submits them to Supabase's native phone/password flow and verifies the matching active, approved `staff_profiles` row. Public staff registration is not available.

## Required Supabase and server configuration

1. Enable Phone Auth and configure a production SMS provider compliant with applicable Indian TRAI/DLT requirements.
2. Enable CAPTCHA and configure Auth rate limits. Consider MFA for staff; phone numbers can be recycled.
3. Configure the SMS provider and enable the staff recovery form. It requests an OTP, verifies possession of the registered number, checks staff active/approval state, updates the Auth password, and clears `force_password_change`.
4. Store `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` only in backend deployment secrets. A legacy service-role key may be accepted server-side, but must never appear in browser code or any `VITE_` variable.
5. Apply the foundation migration and then, if using staff management, the additive [staff management migration](../database/migrations/20261106_003_staff_management.sql). Do not apply `20261105_002_staff_mobile_auth_PREPARE_ONLY.sql`.

## Account provisioning and recovery

Only the designated Main System Administrator can create staff accounts through the protected `/api/admin/staff` endpoint. Supabase Auth receives a cryptographically random temporary password that is not returned or stored by the application. The employee receives a phone verification code and sets a new password through `/staff-login` → **Forgot password?**. Unverified or inactive profiles cannot complete recovery or access the dashboard.

The server creates staff Auth users with the trusted `app_metadata.account_type = 'staff'` marker. The database trigger skips citizen-profile creation for those server-created accounts. Public sign-up cannot set Auth app metadata. Existing Auth users are preserved; the first Main System Administrator must be explicitly bootstrapped by a project owner as described in [staff-management.md](staff-management.md).

The migration does not create staff accounts, contacts, or hierarchy entries from photographs. Only populate the directory after official charts are provided and checked. Never use a phone number as a password or store passwords in `staff_profiles`.

## Authorization and testing

Server endpoints verify the bearer token against Supabase Auth and check the database's Main System Administrator or active staff record. Complaint access additionally requires the staff member's department, active ward assignment, and explicit scoped permissions; RLS and service-only database functions enforce these checks. A frontend role, department, ward, or actor ID is not treated as an authorization source.

Test only with disposable accounts in a non-production project: valid/invalid staff sign-in, citizen credentials at the staff endpoint, forced password recovery, inactive/unapproved accounts, administrator-only account creation, ward/department isolation, permissions, status updates, assignment/escalation history, and private photo access. Do not rely on the UI's role checks as a substitute for RLS tests.
