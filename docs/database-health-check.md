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
-- Tables expected from the corrected foundation migration
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('departments', 'wards', 'profiles', 'staff_profiles',
                    'staff_ward_assignments', 'complaints',
                    'complaint_assignments', 'complaint_status_history')
order by tablename;

-- Expected application indexes
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('complaints', 'staff_ward_assignments',
                    'complaint_assignments', 'complaint_status_history')
order by tablename, indexname;

-- Review policies, including storage policies
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in ('departments', 'wards', 'profiles',
       'staff_profiles', 'staff_ward_assignments', 'complaints',
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

For a meaningful RLS check, create disposable test users in a non-production project. Verify that citizen A cannot select or update citizen B's complaint; staff cannot access a complaint without both the matching department and an active ward assignment; and an explicitly authorized administrator can access complaints. Verify that staff cannot change their own staff profile or ward assignments through the client. A citizen should upload only to their own complaint path, and staff outside its department/ward and citizens other than the owner must not download its linked photo. Browser role checks do not replace these database checks.

See the [database migration runbook](database-migration-runbook.md) for all table relationships, policies, existing-Auth-user repair steps, and the exact application order. Do not apply the staff mobile PREPARE_ONLY migration as part of the corrected foundation.

## Connection guidance

The browser should use the Supabase Data API with its publishable key. Do not add a direct PostgreSQL connection just for the current frontend/Auth flows. If a future server-only feature truly needs PostgreSQL, instantiate one application-lifetime `pg.Pool`, use parameterized queries, keep its credentials in server-only secrets, and close the pool during graceful shutdown. Do not construct a pool per request.
