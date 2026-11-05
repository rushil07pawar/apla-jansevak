# Database health-check procedure

Run these checks against a non-production Supabase project first. They are read-only except where the documented RLS test explicitly creates dedicated test records. Do not use a service-role key in a browser or paste credentials into a terminal transcript.

## Application checks

From the repository root, verify that the API starts and that its process health endpoint responds:

```powershell
cd server
npm start
# In a second terminal:
Invoke-RestMethod http://localhost:5000/api/health
```

This endpoint confirms only that Express is running; it is not a database connectivity check. The current API does not query PostgreSQL.

Build the browser application without displaying local environment values:

```powershell
cd client
npm run build
```

## Supabase dashboard and SQL checks

In the target project, use the Supabase Dashboard SQL Editor with an administrator account. Each query below is read-only.

```sql
-- Tables expected from the foundation migration
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('departments', 'profiles', 'staff_profiles', 'complaints',
                    'complaint_assignments', 'complaint_status_history')
order by tablename;

-- Expected application indexes
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('complaints', 'complaint_assignments', 'complaint_status_history')
order by tablename, indexname;

-- Review policies, including storage policies
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in ('profiles', 'staff_profiles', 'complaints',
       'complaint_assignments', 'complaint_status_history'))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

-- Current database sessions (requires a role allowed to inspect pg_stat_activity)
select datname, usename, application_name, state, count(*) as connections
from pg_stat_activity
where datname = current_database()
group by datname, usename, application_name, state
order by connections desc;
```

For a meaningful RLS check, create two disposable citizen users and one authorised staff user in a non-production project. Using separate authenticated browser sessions, verify that citizen A cannot select or update citizen B's complaint; verify that staff access is limited to its department; and verify that a user outside the allowed department cannot download a complaint photo. Delete the dedicated test records afterwards according to the environment's retention policy.

## Connection guidance

The browser should use the Supabase Data API with its publishable key. Do not add a direct PostgreSQL connection just for the current frontend/Auth flows. If a future server-only feature truly needs PostgreSQL, instantiate one application-lifetime `pg.Pool`, use parameterized queries, keep its credentials in server-only secrets, and close the pool during graceful shutdown. Do not construct a pool per request.
