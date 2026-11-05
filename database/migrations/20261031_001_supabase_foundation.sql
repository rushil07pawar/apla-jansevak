-- FOUNDATION MIGRATION — review and apply manually in the order documented in
-- docs/database-migration-runbook.md. Never executed by the application.
-- Replaces the original, not-yet-applied foundation migration. Does not delete Auth users.

begin;

create extension if not exists citext;
create extension if not exists pgcrypto;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 120),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,32}$'),
  created_at timestamptz not null default now()
);

create table public.wards (
  id uuid primary key default gen_random_uuid(),
  ward_number integer not null unique check (ward_number > 0),
  ward_name text not null check (char_length(trim(ward_name)) between 2 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Use only the supplied pilot designation; do not infer or invent official details.
insert into public.wards (ward_number, ward_name)
values (6, 'Ward 06')
on conflict (ward_number) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null
    check (char_length(trim(full_name)) between 2 and 100),
  username citext not null unique
    check (username ~ '^[A-Za-z0-9_]{3,30}$'),
  phone text not null
    check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  residential_address text not null
    check (char_length(trim(residential_address)) between 10 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  mobile_e164 text not null unique
    check (mobile_e164 ~ '^[+]91[6-9][0-9]{9}$'),
  role text not null check (role in ('staff', 'supervisor', 'administrator')),
  active boolean not null default true,
  approved boolean not null default false,
  force_password_change boolean not null default true,
  provisioned_at timestamptz not null default now()
);

create table public.staff_ward_assignments (
  staff_user_id uuid not null
    references public.staff_profiles(user_id) on delete cascade,
  ward_id uuid not null references public.wards(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (staff_user_id, ward_id)
);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references public.profiles(id) on delete restrict,
  department_id uuid references public.departments(id) on delete set null,
  ward_id uuid not null references public.wards(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 5 and 160),
  description text not null check (char_length(trim(description)) between 10 and 5000),
  category text not null check (char_length(trim(category)) between 2 and 80),
  severity smallint not null default 1 check (severity between 1 and 5),
  status text not null default 'submitted'
    check (status in ('submitted', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')),
  latitude numeric(9,6),
  longitude numeric(9,6),
  photo_path text
    check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create table public.complaint_assignments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  staff_user_id uuid not null references public.staff_profiles(user_id) on delete restrict,
  assigned_by uuid not null references public.staff_profiles(user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  unique (complaint_id, staff_user_id, assigned_at)
);

create table public.complaint_status_history (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  previous_status text,
  new_status text not null
    check (new_status in ('submitted', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected')),
  note text check (char_length(note) <= 2000),
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index complaints_citizen_idx on public.complaints (citizen_id);
create index complaints_department_ward_idx on public.complaints (department_id, ward_id);
create index staff_ward_assignments_ward_idx
  on public.staff_ward_assignments (ward_id, staff_user_id);
create index assignment_staff_active_idx
  on public.complaint_assignments (staff_user_id)
  where unassigned_at is null;
create index history_complaint_idx
  on public.complaint_status_history (complaint_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_updated
before update on public.profiles
for each row execute procedure public.set_updated_at();

create trigger complaints_updated
before update on public.complaints
for each row execute procedure public.set_updated_at();

-- Every Auth user must carry the required profile metadata, including staff
-- provisioned through Auth. Any error aborts the Auth insert; no partial account remains.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_full_name text;
  v_username text;
  v_phone text;
  v_address text;
begin
  if jsonb_typeof(v_metadata -> 'full_name') is distinct from 'string'
     or jsonb_typeof(v_metadata -> 'username') is distinct from 'string'
     or jsonb_typeof(v_metadata -> 'phone') is distinct from 'string'
     or jsonb_typeof(v_metadata -> 'residential_address') is distinct from 'string' then
    raise exception using
      errcode = '22023',
      message = 'Registration requires string values for full_name, username, phone, and residential_address';
  end if;

  v_full_name := nullif(btrim(v_metadata ->> 'full_name'), '');
  v_username := lower(nullif(btrim(v_metadata ->> 'username'), ''));
  v_phone := nullif(btrim(v_metadata ->> 'phone'), '');
  v_address := nullif(btrim(v_metadata ->> 'residential_address'), '');

  if v_full_name is null or char_length(v_full_name) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'Registration metadata has an invalid full name';
  end if;
  if v_username is null or v_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception using errcode = '22023', message = 'Registration metadata has an invalid username';
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'Registration metadata has an invalid phone number';
  end if;
  if v_address is null or char_length(v_address) not between 10 and 300 then
    raise exception using errcode = '22023', message = 'Registration metadata has an invalid residential address';
  end if;

  begin
    insert into public.profiles (id, full_name, username, phone, residential_address)
    values (new.id, v_full_name, v_username, v_phone, v_address);
  exception
    when unique_violation then
      if exists (select 1 from public.profiles p where p.username = v_username) then
        raise exception using errcode = '23505', message = 'Username is already in use';
      end if;
      raise;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create function public.is_authorized_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and sp.role = 'administrator'
      and sp.active
      and sp.approved
      and not sp.force_password_change
  );
$$;

create function public.staff_authorized_for_complaint(
  target_department uuid,
  target_ward uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_authorized_administrator()
    or exists (
      select 1
      from public.staff_profiles sp
      join public.staff_ward_assignments swa on swa.staff_user_id = sp.user_id
      join public.wards w on w.id = swa.ward_id and w.is_active
      where sp.user_id = (select auth.uid())
        and sp.role in ('staff', 'supervisor')
        and sp.active
        and sp.approved
        and not sp.force_password_change
        and sp.department_id = target_department
        and swa.ward_id = target_ward
    );
$$;

-- Only an approved supervisor/administrator with the same department and ward
-- may assign an approved staff member to a complaint.
create function public.validate_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_department uuid;
  v_ward uuid;
  v_assignee_department uuid;
  v_assignee_authorized boolean;
  v_assigner_department uuid;
  v_assigner_role text;
  v_assigner_authorized boolean;
begin
  select c.department_id, c.ward_id
  into v_department, v_ward
  from public.complaints c
  where c.id = new.complaint_id;

  select sp.department_id, (sp.active and sp.approved and not sp.force_password_change)
  into v_assignee_department, v_assignee_authorized
  from public.staff_profiles sp
  where sp.user_id = new.staff_user_id;

  select sp.department_id, sp.role,
         (sp.active and sp.approved and not sp.force_password_change)
  into v_assigner_department, v_assigner_role, v_assigner_authorized
  from public.staff_profiles sp
  where sp.user_id = new.assigned_by;

  if v_department is null
     or v_assignee_department is distinct from v_department
     or v_assigner_department is distinct from v_department
     or v_assigner_role not in ('supervisor', 'administrator')
     or v_assignee_authorized is distinct from true
     or v_assigner_authorized is distinct from true
     or not exists (
       select 1 from public.staff_ward_assignments swa
       join public.wards w on w.id = swa.ward_id and w.is_active
       where swa.staff_user_id = new.staff_user_id and swa.ward_id = v_ward
     )
     or not exists (
       select 1 from public.staff_ward_assignments swa
       join public.wards w on w.id = swa.ward_id and w.is_active
       where swa.staff_user_id = new.assigned_by and swa.ward_id = v_ward
     ) then
    raise exception using errcode = '42501', message = 'Invalid complaint assignment authorization';
  end if;

  return new;
end;
$$;

create trigger assignment_is_authorized
before insert on public.complaint_assignments
for each row execute procedure public.validate_assignment();

alter table public.departments enable row level security;
alter table public.wards enable row level security;
alter table public.profiles enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_ward_assignments enable row level security;
alter table public.complaints enable row level security;
alter table public.complaint_assignments enable row level security;
alter table public.complaint_status_history enable row level security;

revoke all on table
  public.departments,
  public.wards,
  public.profiles,
  public.staff_profiles,
  public.staff_ward_assignments,
  public.complaints,
  public.complaint_assignments,
  public.complaint_status_history
from public, anon, authenticated;

grant select on public.departments, public.wards to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, username, phone, residential_address) on public.profiles to authenticated;
grant select on public.staff_profiles, public.staff_ward_assignments to authenticated;
grant select on public.complaints to authenticated;
grant insert (citizen_id, ward_id, title, description, category, severity, latitude, longitude)
  on public.complaints to authenticated;
grant update (title, description, category, severity, ward_id, latitude, longitude, photo_path)
  on public.complaints to authenticated;
grant select on public.complaint_assignments, public.complaint_status_history to authenticated;

create policy "read departments"
on public.departments for select to authenticated
using (true);

create policy "read active wards"
on public.wards for select to authenticated
using (is_active);

create policy "read own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "update own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "read own staff record"
on public.staff_profiles for select to authenticated
using (user_id = (select auth.uid()));

create policy "read own ward assignments"
on public.staff_ward_assignments for select to authenticated
using (staff_user_id = (select auth.uid()));

create policy "citizen reads own complaints"
on public.complaints for select to authenticated
using (citizen_id = (select auth.uid()));

create policy "staff reads authorized complaints"
on public.complaints for select to authenticated
using (public.staff_authorized_for_complaint(department_id, ward_id));

create policy "citizen creates own submitted complaint"
on public.complaints for insert to authenticated
with check (
  citizen_id = (select auth.uid())
  and department_id is null
  and status = 'submitted'
  and photo_path is null
  and exists (select 1 from public.wards w where w.id = ward_id and w.is_active)
);

create policy "citizen updates own unassigned complaint"
on public.complaints for update to authenticated
using (
  citizen_id = (select auth.uid())
  and status = 'submitted'
  and department_id is null
)
with check (
  citizen_id = (select auth.uid())
  and status = 'submitted'
  and department_id is null
  and exists (select 1 from public.wards w where w.id = ward_id and w.is_active)
  and (
    photo_path is null
    or (
      split_part(photo_path, '/', 1) = (select auth.uid())::text
      and split_part(photo_path, '/', 2) = id::text
    )
  )
);

create policy "read own or authorized complaint assignments"
on public.complaint_assignments for select to authenticated
using (
  staff_user_id = (select auth.uid())
  or exists (
    select 1
    from public.complaints c
    where c.id = complaint_id
      and (
        c.citizen_id = (select auth.uid())
        or public.staff_authorized_for_complaint(c.department_id, c.ward_id)
      )
  )
);

create policy "read own or authorized complaint history"
on public.complaint_status_history for select to authenticated
using (
  exists (
    select 1
    from public.complaints c
    where c.id = complaint_id
      and (
        c.citizen_id = (select auth.uid())
        or public.staff_authorized_for_complaint(c.department_id, c.ward_id)
      )
  )
);

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_authorized_administrator() from public, anon, authenticated;
revoke all on function public.staff_authorized_for_complaint(uuid, uuid) from public, anon;
revoke all on function public.validate_assignment() from public, anon, authenticated;
grant execute on function public.is_authorized_administrator() to authenticated;
grant execute on function public.staff_authorized_for_complaint(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'complaint-photos',
  'complaint-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "upload photo to own complaint"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'complaint-photos'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.complaints c
    where c.id::text = (storage.foldername(name))[2]
      and c.citizen_id = (select auth.uid())
  )
);

create policy "read linked complaint photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'complaint-photos'
  and exists (
    select 1
    from public.complaints c
    where c.photo_path = name
      and (
        c.citizen_id = (select auth.uid())
        or public.staff_authorized_for_complaint(c.department_id, c.ward_id)
      )
  )
);

create policy "delete own unlinked complaint photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'complaint-photos'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.complaints c
    where c.id::text = (storage.foldername(name))[2]
      and c.citizen_id = (select auth.uid())
      and not exists (
        select 1
        from public.complaints linked
        where linked.photo_path = name
      )
  )
);

-- Restrictive guards ensure another permissive storage policy cannot broaden
-- complaint-photo access. Other buckets retain their existing policy behavior.
create policy "deny anonymous complaint photo access"
on storage.objects as restrictive for all to anon
using (bucket_id <> 'complaint-photos')
with check (bucket_id <> 'complaint-photos');

create policy "restrict complaint photo reads"
on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'complaint-photos'
  or exists (
    select 1
    from public.complaints c
    where c.photo_path = name
      and (
        c.citizen_id = (select auth.uid())
        or public.staff_authorized_for_complaint(c.department_id, c.ward_id)
      )
  )
);

create policy "restrict complaint photo uploads"
on storage.objects as restrictive for insert to authenticated
with check (
  bucket_id <> 'complaint-photos'
  or (
    array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.complaints c
      where c.id::text = (storage.foldername(name))[2]
        and c.citizen_id = (select auth.uid())
    )
  )
);

create policy "prevent complaint photo updates"
on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'complaint-photos')
with check (bucket_id <> 'complaint-photos');

create policy "restrict complaint photo deletion"
on storage.objects as restrictive for delete to authenticated
using (
  bucket_id <> 'complaint-photos'
  or (
    array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.complaints c
      where c.id::text = (storage.foldername(name))[2]
        and c.citizen_id = (select auth.uid())
        and not exists (
          select 1
          from public.complaints linked
          where linked.photo_path = name
        )
    )
  )
);

-- No authenticated or anon write policy exists for staff provisioning, ward
-- assignments, complaint assignments, complaint status, or status history.

commit;
