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
2. Apply [20261031_001_supabase_foundation.sql](database/migrations/20261031_001_supabase_foundation.sql) with the Supabase SQL Editor or CLI (`supabase link`, then `supabase db push`).
3. Keep email confirmation enabled in production. If registration returns no session, the citizen must confirm their email before logging in.
4. The migration creates a private `complaint-photos` bucket, limits images to JPEG/PNG/WebP and 5 MB, and applies storage policies. Use signed URLs or authenticated downloads—never public URLs—for photographs.
5. Provision staff through a trusted server/admin process only. Create the Auth user, then the `staff_profiles` row with an authorised department and role. Keep any service-role key exclusively in server/Edge Function secrets.

All public tables enable Row Level Security. Citizens can access only their own profile and complaints. Staff access is restricted to active authorised department membership; complaint assignments require a supervisor or administrator and a matching department. The browser has no policies allowing staff, assignment, or history creation.

## Current scope

- Responsive citizen homepage and civic-service overview
- Citizen email/password registration and login, once configured
- Separate municipal staff login, restricted to provisioned staff accounts
- Client-side validation for username, E.164 phone number, residential address, and password confirmation
- `GET /api/health` API endpoint

Complaint submission and tracking are future work. Passwords are only sent to Supabase Auth and are never stored by the application.

## Deployment checklist

- Set the two `VITE_SUPABASE_*` values in protected frontend-host environment settings and rebuild.
- Set `CLIENT_ORIGIN` on the server to the deployed frontend origin.
- Before launch, test registration/email confirmation, profile isolation, complaint RLS, staff department access, and private-photo access against a non-production Supabase project.
