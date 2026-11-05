# AplaJansevak | आपला जनसेवक

**Your Voice, Our Responsibility.**

AplaJansevak is a civic grievance-management platform being piloted for Ward No. 6 in Bhiwandi, Maharashtra. It includes a React citizen interface, an Express API foundation, and a production-oriented Supabase authentication/database design.

## Architecture

- `client/` — React + Vite citizen interface and Supabase Auth client
- `server/` — Express API with Helmet, CORS, dotenv, and a health endpoint
- `database/migrations/` — version-controlled Supabase/Postgres schema and RLS policies
- `docs/` — project documentation

## Run locally

Open two terminals from the project root:

```powershell
cd client; npm run dev
cd server; npm run dev
```

The client runs at `http://localhost:5173`; the API health endpoint is `http://localhost:5000/api/health`.

## Supabase local configuration

Create `client/.env.local` from `client/.env.example`, then add values from **Supabase Dashboard → Project Settings → API**:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
```

Use only the publishable (or legacy anon) key in the Vite app. Never add a service-role key, database password, or personal token to any `VITE_` variable or commit it to Git.

## Database and security setup

1. Create a Supabase project and enable email/password Auth. Configure the local and deployed client URLs in Auth settings.
2. Review and follow the [database migration runbook](docs/database-migration-runbook.md) before manually applying [20261031_001_supabase_foundation.sql](database/migrations/20261031_001_supabase_foundation.sql) in the Supabase SQL Editor. The migration is not executed by the application and preserves existing Auth users.
3. Keep email confirmation enabled in production. If registration returns no session, the citizen must confirm their email before logging in.
4. The migration creates a private `complaint-photos` bucket, limits images to JPEG/PNG/WebP and 5 MB, and authorizes photos through linked complaint ownership or staff department-and-ward access. Use signed URLs or authenticated downloads—never public URLs—for photographs.
5. Provision staff through a trusted server/admin process only. Create the Auth user, then the `staff_profiles` row with an authorised department and role. Keep any service-role key exclusively in server/Edge Function secrets.

All application tables enable Row Level Security. Citizens can access only their own permitted profile and complaints. Staff complaint access requires active, approved staff status plus both matching department and ward assignment; an explicitly authorized administrator has complaint-wide access. The browser has no policies for staff provisioning or assignment and no complaint status/history write access.

## Current scope

- Responsive citizen homepage and civic-service overview
- Citizen email/password registration and login, with email-confirmation-aware redirects
- Protected geotagged complaint submission with a mandatory private photo and owner-only status view
- Separate municipal staff login, restricted to provisioned staff accounts
- Staff dashboard entry checks active approval and authorized ward assignments
- Client-side validation for username, E.164 phone number, residential address, photo format/size, and browser location
- `GET /api/health` API endpoint

Citizen complaint rows and photos use the existing Supabase schema and private `complaint-photos` bucket. The form uses the four category labels already present in the project; department routing and severity analysis remain pending and are not fabricated by the client. A photo-upload failure after row creation leaves an incomplete citizen-owned row that can be retried from the same form. Passwords are only sent to Supabase Auth and are never stored by the application. Staff use their provisioned mobile number as the Auth login identifier; there is no public staff registration.

## Database health checks

Use the read-only [database health-check procedure](docs/database-health-check.md) to verify schema, RLS policies, storage policies, and connection usage. Perform authorisation tests only in a non-production Supabase project.

Staff phone/password authentication is described in [staff-mobile-auth.md](docs/staff-mobile-auth.md). The corrected foundation already defines the staff mobile and approval fields. Do not apply [20261105_002_staff_mobile_auth_PREPARE_ONLY.sql](database/migrations/20261105_002_staff_mobile_auth_PREPARE_ONLY.sql) with this foundation.

## Deployment checklist

The frontend package is in `client/`; the repository root has no `package.json`. Set the Vercel project's **Root Directory** to `client`. The tracked `client/vercel.json` installs from `client/package-lock.json` including dev dependencies, runs `npm run build`, and serves `dist`. Do not override these commands with `vite build` or an install command that omits dev dependencies: Vite is a frontend dev dependency.

- Set the two `VITE_SUPABASE_*` values in protected frontend-host environment settings and rebuild.
- Set `CLIENT_ORIGIN` on the server to the deployed frontend origin.
- Before launch, test registration/email confirmation, profile isolation, complaint RLS, staff department access, and private-photo access against a non-production Supabase project.
