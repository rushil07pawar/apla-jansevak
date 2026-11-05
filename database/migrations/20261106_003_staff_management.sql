-- Additive municipal staff directory, scoped permissions, and audit support.
-- Apply manually only after reviewing docs/staff-management.md.
begin;

alter table public.departments
  add column if not exists name_mr text;

insert into public.departments (code, name, name_mr)
values
  ('CONSTRUCTION', 'Construction Department', 'बांधकाम विभाग'),
  ('WATER_DRAINAGE', 'Water Supply and Drainage Department', 'पाणी पुरवठा व मलनिस्सारण'),
  ('GARDEN', 'Garden Department', 'उद्यान विभाग'),
  ('SANITATION', 'Sanitation Department', 'स्वच्छता विभाग'),
  ('ELECTRICITY', 'Electricity Department', 'विद्युत विभाग'),
  ('EMERGENCY', 'Emergency Management Department', 'आपत्कालीन व्यवस्थापन')
on conflict (code) do update
set name = excluded.name,
    name_mr = excluded.name_mr;

alter table public.staff_profiles
  add column if not exists staff_id text,
  add column if not exists full_name_mr text,
  add column if not exists full_name_en text,
  add column if not exists designation_mr text,
  add column if not exists designation_en text,
  add column if not exists official_contact_number text,
  add column if not exists profile_verified boolean not null default false,
  add column if not exists is_main_system_admin boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update public.staff_profiles
set official_contact_number = mobile_e164
where official_contact_number is null;

alter table public.staff_profiles
  alter column official_contact_number set not null;

create unique index if not exists staff_profiles_staff_id_unique
  on public.staff_profiles (staff_id)
  where staff_id is not null;
create unique index if not exists staff_profiles_contact_unique
  on public.staff_profiles (official_contact_number);
create unique index if not exists staff_profiles_single_main_admin
  on public.staff_profiles (is_main_system_admin)
  where is_main_system_admin;

alter table public.staff_profiles
  add constraint staff_profiles_contact_e164
    check (official_contact_number ~ '^[+]91[6-9][0-9]{9}$'),
  add constraint staff_profiles_verified_fields
    check (
      not profile_verified
      or (
        staff_id is not null
        and (nullif(btrim(full_name_mr), '') is not null
          or nullif(btrim(full_name_en), '') is not null)
        and (nullif(btrim(designation_mr), '') is not null
          or nullif(btrim(designation_en), '') is not null)
      )
    );

create table if not exists public.staff_hierarchy (
  staff_user_id uuid primary key
    references public.staff_profiles(user_id) on delete cascade,
  reports_to_user_id uuid not null
    references public.staff_profiles(user_id) on delete restrict,
  department_id uuid not null
    references public.departments(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (staff_user_id <> reports_to_user_id)
);

create index if not exists staff_hierarchy_reporting_idx
  on public.staff_hierarchy (reports_to_user_id);

create table if not exists public.staff_permissions (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null
    references public.staff_profiles(user_id) on delete cascade,
  permission_code text not null
    check (permission_code in (
      'complaints.read',
      'complaints.update',
      'complaints.assign',
      'complaints.escalate'
    )),
  department_id uuid not null
    references public.departments(id) on delete cascade,
  ward_id uuid not null
    references public.wards(id) on delete restrict,
  granted_by uuid not null
    references public.staff_profiles(user_id) on delete restrict,
  granted_at timestamptz not null default now(),
  unique (staff_user_id, permission_code, department_id, ward_id)
);

create index if not exists staff_permissions_scope_idx
  on public.staff_permissions (staff_user_id, department_id, ward_id, permission_code);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null
    references public.staff_profiles(user_id) on delete restrict,
  action text not null check (char_length(action) between 2 and 100),
  target_type text not null check (char_length(target_type) between 2 and 80),
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

drop policy if exists "read own or authorized complaint assignments"
  on public.complaint_assignments;
create policy "read own or authorized complaint assignments"
on public.complaint_assignments for select to authenticated
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

alter table public.complaint_status_history
  add column if not exists event_type text not null default 'status'
    check (event_type in ('status', 'assignment', 'escalation', 'routing')),
  add column if not exists previous_assignee_id uuid
    references public.staff_profiles(user_id) on delete set null,
  add column if not exists new_assignee_id uuid
    references public.staff_profiles(user_id) on delete set null,
  add column if not exists details jsonb not null default '{}'::jsonb;

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_actor_idx
  on public.admin_audit_logs (actor_user_id, created_at desc);

create or replace function public.is_main_system_administrator()
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
      and sp.is_main_system_admin
      and sp.role = 'administrator'
      and sp.active
      and sp.approved
      and not sp.force_password_change
  );
$$;

create or replace function public.is_authorized_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_main_system_administrator();
$$;

create or replace function public.staff_has_complaint_permission(
  target_department uuid,
  target_ward uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_main_system_administrator()
    or exists (
      select 1
      from public.staff_profiles sp
      join public.staff_ward_assignments swa
        on swa.staff_user_id = sp.user_id and swa.ward_id = target_ward
      join public.wards w on w.id = swa.ward_id and w.is_active
      join public.staff_permissions perm
        on perm.staff_user_id = sp.user_id
       and perm.department_id = target_department
       and perm.ward_id = target_ward
       and perm.permission_code = required_permission
      where sp.user_id = (select auth.uid())
        and sp.department_id = target_department
        and sp.active
        and sp.approved
        and not sp.force_password_change
    );
$$;

create or replace function public.staff_user_has_complaint_permission(
  target_staff_user uuid,
  target_department uuid,
  target_ward uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    join public.staff_ward_assignments swa
      on swa.staff_user_id = sp.user_id and swa.ward_id = target_ward
    join public.wards w on w.id = swa.ward_id and w.is_active
    join public.staff_permissions perm
      on perm.staff_user_id = sp.user_id
     and perm.department_id = target_department
     and perm.ward_id = target_ward
     and perm.permission_code = required_permission
    where sp.user_id = target_staff_user
      and sp.department_id = target_department
      and sp.active
      and sp.approved
      and not sp.force_password_change
  );
$$;

create or replace function public.staff_authorized_for_complaint(
  target_department uuid,
  target_ward uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_has_complaint_permission(
    target_department,
    target_ward,
    'complaints.read'
  );
$$;

create or replace function public.validate_assignment()
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
  v_assigner_authorized boolean;
begin
  select c.department_id, c.ward_id
    into v_department, v_ward
  from public.complaints c
  where c.id = new.complaint_id;
  select sp.department_id, (sp.active and sp.approved and not sp.force_password_change)
    into v_assignee_department, v_assignee_authorized
  from public.staff_profiles sp where sp.user_id = new.staff_user_id;
  select sp.department_id, (sp.active and sp.approved and not sp.force_password_change)
    into v_assigner_department, v_assigner_authorized
  from public.staff_profiles sp where sp.user_id = new.assigned_by;

  if v_department is null
     or v_assignee_department is distinct from v_department
     or v_assignee_authorized is distinct from true
     or v_assigner_authorized is distinct from true
     or not exists (
       select 1 from public.staff_ward_assignments swa
       join public.wards w on w.id = swa.ward_id and w.is_active
       where swa.staff_user_id = new.staff_user_id and swa.ward_id = v_ward
     )
     or (
       not exists (
         select 1 from public.staff_profiles sp
         where sp.user_id = new.assigned_by and sp.is_main_system_admin
           and sp.role = 'administrator' and sp.active and sp.approved
           and not sp.force_password_change
       )
       and (
         v_assigner_department is distinct from v_department
         or not exists (
           select 1 from public.staff_ward_assignments swa
           join public.wards w on w.id = swa.ward_id and w.is_active
           where swa.staff_user_id = new.assigned_by and swa.ward_id = v_ward
         )
         or (
           not public.staff_user_has_complaint_permission(
             new.assigned_by, v_department, v_ward, 'complaints.assign'
           )
           and not public.staff_user_has_complaint_permission(
             new.assigned_by, v_department, v_ward, 'complaints.escalate'
           )
         )
       )
     ) then
    raise exception using errcode = '42501', message = 'Invalid complaint assignment authorization';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
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
  if new.raw_app_meta_data ->> 'account_type' = 'staff' then
    return new;
  end if;

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

create or replace function public.manage_staff_directory(
  p_actor uuid,
  p_action text,
  p_staff_user_id uuid,
  p_profile jsonb default '{}'::jsonb,
  p_ward_ids uuid[] default '{}'::uuid[],
  p_permissions jsonb default '[]'::jsonb,
  p_reports_to_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_old_access jsonb;
  v_department_id uuid;
  v_new jsonb;
  v_new_access jsonb;
begin
  if not exists (
    select 1 from public.staff_profiles
    where user_id = p_actor
      and is_main_system_admin
      and role = 'administrator'
      and active and approved and not force_password_change
  ) then
    raise exception using errcode = '42501', message = 'Main system administrator authorization required';
  end if;
  if p_action is null or p_action not in ('upsert', 'set_active') then
    raise exception using errcode = '22023', message = 'Unsupported staff management action';
  end if;

  select to_jsonb(sp), sp.department_id
    into v_old, v_department_id
  from public.staff_profiles sp
  where sp.user_id = p_staff_user_id;
  select jsonb_build_object(
    'wards', coalesce((
      select jsonb_agg(swa.ward_id order by swa.ward_id)
      from public.staff_ward_assignments swa
      where swa.staff_user_id = p_staff_user_id
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(to_jsonb(perm) order by perm.permission_code, perm.ward_id)
      from public.staff_permissions perm
      where perm.staff_user_id = p_staff_user_id
    ), '[]'::jsonb),
    'reports_to_user_id', (
      select h.reports_to_user_id
      from public.staff_hierarchy h
      where h.staff_user_id = p_staff_user_id
    )
  ) into v_old_access;

  if p_action = 'upsert' then
    if v_old is not null
       and v_department_id is distinct from (p_profile ->> 'department_id')::uuid
       and exists (
         select 1 from public.staff_hierarchy
         where reports_to_user_id = p_staff_user_id
       ) then
      raise exception using errcode = '23514', message = 'Reassign this staff member''s direct reports before changing departments';
    end if;
    if v_old ->> 'is_main_system_admin' = 'true'
       and (
         p_profile ->> 'role' <> 'administrator'
         or coalesce((p_profile ->> 'active')::boolean, true) is false
         or coalesce((p_profile ->> 'approved')::boolean, false) is false
         or (p_profile ->> 'mobile_e164') <> (v_old ->> 'mobile_e164')
       ) then
      raise exception using errcode = '42501', message = 'The Main System Administrator account cannot be demoted, deactivated, or have its login changed here';
    end if;
    if coalesce((p_profile ->> 'approved')::boolean, false)
       and not coalesce((p_profile ->> 'profile_verified')::boolean, false) then
      raise exception using errcode = '22023', message = 'Verify the directory details before approving the staff account';
    end if;
    insert into public.staff_profiles (
      user_id, department_id, mobile_e164, official_contact_number,
      role, active, approved, force_password_change, staff_id,
      full_name_mr, full_name_en, designation_mr, designation_en, profile_verified
    )
    values (
      p_staff_user_id,
      (p_profile ->> 'department_id')::uuid,
      p_profile ->> 'mobile_e164',
      coalesce(p_profile ->> 'official_contact_number', p_profile ->> 'mobile_e164'),
      p_profile ->> 'role',
      coalesce((p_profile ->> 'active')::boolean, true),
      coalesce((p_profile ->> 'approved')::boolean, false),
      true,
      nullif(btrim(p_profile ->> 'staff_id'), ''),
      nullif(btrim(p_profile ->> 'full_name_mr'), ''),
      nullif(btrim(p_profile ->> 'full_name_en'), ''),
      nullif(btrim(p_profile ->> 'designation_mr'), ''),
      nullif(btrim(p_profile ->> 'designation_en'), ''),
      coalesce((p_profile ->> 'profile_verified')::boolean, false)
    )
    on conflict (user_id) do update set
      department_id = excluded.department_id,
      mobile_e164 = excluded.mobile_e164,
      official_contact_number = excluded.official_contact_number,
      role = excluded.role,
      active = excluded.active,
      approved = excluded.approved,
      force_password_change = case
        when public.staff_profiles.mobile_e164 <> excluded.mobile_e164 then true
        else public.staff_profiles.force_password_change
      end,
      staff_id = excluded.staff_id,
      full_name_mr = excluded.full_name_mr,
      full_name_en = excluded.full_name_en,
      designation_mr = excluded.designation_mr,
      designation_en = excluded.designation_en,
      profile_verified = excluded.profile_verified,
      updated_at = pg_catalog.now();
    v_department_id := (p_profile ->> 'department_id')::uuid;

    delete from public.staff_ward_assignments where staff_user_id = p_staff_user_id;
    insert into public.staff_ward_assignments (staff_user_id, ward_id)
    select p_staff_user_id, ward_id
    from unnest(coalesce(p_ward_ids, '{}'::uuid[])) as assigned_wards(ward_id)
    on conflict do nothing;

    delete from public.staff_permissions where staff_user_id = p_staff_user_id;
    if jsonb_typeof(coalesce(p_permissions, '[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'Permissions must be an array';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb)) as permission_items(item)
      where not ((item ->> 'ward_id')::uuid = any(coalesce(p_ward_ids, '{}'::uuid[])))
    ) then
      raise exception using errcode = '22023', message = 'Permission wards must be assigned to the staff member';
    end if;
    insert into public.staff_permissions (
      staff_user_id, permission_code, department_id, ward_id, granted_by
    )
    select p_staff_user_id,
      item ->> 'permission_code',
      v_department_id,
      (item ->> 'ward_id')::uuid,
      p_actor
    from jsonb_array_elements(coalesce(p_permissions, '[]'::jsonb)) as permission_items(item);

    delete from public.staff_hierarchy where staff_user_id = p_staff_user_id;
    if p_reports_to_user_id is not null then
      if exists (
        with recursive manager_chain(user_id) as (
          select p_reports_to_user_id
          union
          select h.reports_to_user_id
          from public.staff_hierarchy h
          join manager_chain chain on chain.user_id = h.staff_user_id
        )
        select 1 from manager_chain where user_id = p_staff_user_id
      ) then
        raise exception using errcode = '22023', message = 'Reporting relationship would create a cycle';
      end if;
      insert into public.staff_hierarchy (staff_user_id, reports_to_user_id, department_id)
      select p_staff_user_id, p_reports_to_user_id, v_department_id
      where exists (
        select 1 from public.staff_profiles manager
        where manager.user_id = p_reports_to_user_id
          and manager.department_id = v_department_id
          and manager.active and manager.approved
          and not manager.force_password_change
      );
      if not found then
        raise exception using errcode = '22023', message = 'Reporting officer must be active in the same department';
      end if;
    end if;

  elsif p_action = 'set_active' then
    if v_old is null then
      raise exception using errcode = 'P0002', message = 'Staff profile not found';
    end if;
    if v_old ->> 'is_main_system_admin' = 'true'
       and coalesce((p_profile ->> 'active')::boolean, false) is false then
      raise exception using errcode = '42501', message = 'The Main System Administrator account cannot be deactivated here';
    end if;
    if coalesce((p_profile ->> 'active')::boolean, false) is false
       and exists (
         select 1 from public.staff_hierarchy
         where reports_to_user_id = p_staff_user_id
       ) then
      raise exception using errcode = '23514', message = 'Reassign this staff member''s direct reports before deactivation';
    end if;
    update public.staff_profiles
    set active = (p_profile ->> 'active')::boolean,
        updated_at = pg_catalog.now()
    where user_id = p_staff_user_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'Staff profile not found';
    end if;

  end if;

  select to_jsonb(sp) into v_new
  from public.staff_profiles sp
  where sp.user_id = p_staff_user_id;
  select jsonb_build_object(
    'wards', coalesce((
      select jsonb_agg(swa.ward_id order by swa.ward_id)
      from public.staff_ward_assignments swa
      where swa.staff_user_id = p_staff_user_id
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(to_jsonb(perm) order by perm.permission_code, perm.ward_id)
      from public.staff_permissions perm
      where perm.staff_user_id = p_staff_user_id
    ), '[]'::jsonb),
    'reports_to_user_id', (
      select h.reports_to_user_id
      from public.staff_hierarchy h
      where h.staff_user_id = p_staff_user_id
    )
  ) into v_new_access;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, details)
  values (
    p_actor,
    'staff.' || p_action,
    'staff_profile',
    p_staff_user_id::text,
    jsonb_build_object(
      'before', v_old,
      'after', v_new,
      'access_before', v_old_access,
      'access_after', v_new_access
    )
  );
  return coalesce(v_new, '{}'::jsonb);
end;
$$;

create or replace function public.manage_complaint(
  p_actor uuid,
  p_action text,
  p_complaint_id uuid,
  p_status text default null,
  p_note text default null,
  p_assignee_id uuid default null,
  p_department_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complaint public.complaints%rowtype;
  v_permission text;
  v_previous_assignee uuid;
begin
  if p_action is null or p_action not in ('status', 'assign', 'escalate', 'route') then
    raise exception using errcode = '22023', message = 'Unsupported complaint action';
  end if;
  select * into v_complaint
  from public.complaints c
  where c.id = p_complaint_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Complaint not found';
  end if;
  if p_action = 'route' then
    if not exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = p_actor
        and sp.is_main_system_admin
        and sp.role = 'administrator'
        and sp.active and sp.approved and not sp.force_password_change
    ) then
      raise exception using errcode = '42501', message = 'Main system administrator authorization required';
    end if;
    if p_department_id is null
       or not exists (select 1 from public.departments d where d.id = p_department_id)
       or not exists (select 1 from public.wards w where w.id = v_complaint.ward_id and w.is_active) then
      raise exception using errcode = '22023', message = 'Select a valid department for an active ward';
    end if;
    update public.complaints set department_id = p_department_id where id = p_complaint_id;
    insert into public.complaint_status_history (
      complaint_id, previous_status, new_status, note, changed_by, event_type, details
    ) values (
      p_complaint_id, v_complaint.status, v_complaint.status, p_note, p_actor,
      'routing', jsonb_build_object(
        'previous_department_id', v_complaint.department_id,
        'department_id', p_department_id
      )
    );
    return jsonb_build_object('id', p_complaint_id, 'department_id', p_department_id, 'status', v_complaint.status);
  end if;
  if v_complaint.department_id is null then
    raise exception using errcode = 'P0002', message = 'Complaint must be routed before staff actions';
  end if;

  v_permission := case p_action
    when 'status' then 'complaints.update'
    when 'assign' then 'complaints.assign'
    else 'complaints.escalate'
  end;
  if not (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = p_actor
        and sp.is_main_system_admin
        and sp.role = 'administrator'
        and sp.active and sp.approved and not sp.force_password_change
    )
    or public.staff_user_has_complaint_permission(
      p_actor, v_complaint.department_id, v_complaint.ward_id, v_permission
    )
  ) then
    raise exception using errcode = '42501', message = 'Not authorized for this complaint action';
  end if;

  select ca.staff_user_id into v_previous_assignee
  from public.complaint_assignments ca
  where ca.complaint_id = p_complaint_id and ca.unassigned_at is null
  order by ca.assigned_at desc limit 1;

  if p_action = 'status' then
    if p_status is null
       or p_status not in ('acknowledged', 'in_progress', 'resolved', 'closed', 'rejected') then
      raise exception using errcode = '22023', message = 'Unsupported complaint status';
    end if;
    update public.complaints set status = p_status where id = p_complaint_id;
    insert into public.complaint_status_history (
      complaint_id, previous_status, new_status, note, changed_by, event_type
    ) values (
      p_complaint_id, v_complaint.status, p_status, p_note, p_actor, 'status'
    );
  elsif p_action = 'assign' then
    if p_assignee_id is null
       or not exists (
         select 1 from public.staff_profiles sp
         join public.staff_ward_assignments swa on swa.staff_user_id = sp.user_id
         where sp.user_id = p_assignee_id
           and sp.department_id = v_complaint.department_id
           and sp.active and sp.approved and not sp.force_password_change
           and swa.ward_id = v_complaint.ward_id
       ) then
      raise exception using errcode = '22023', message = 'Assignee is not authorized for this complaint ward';
    end if;
    update public.complaint_assignments
    set unassigned_at = pg_catalog.now()
    where complaint_id = p_complaint_id and unassigned_at is null;
    insert into public.complaint_assignments (
      complaint_id, staff_user_id, assigned_by
    ) values (p_complaint_id, p_assignee_id, p_actor);
    insert into public.complaint_status_history (
      complaint_id, previous_status, new_status, note, changed_by,
      event_type, previous_assignee_id, new_assignee_id
    ) values (
      p_complaint_id, v_complaint.status, v_complaint.status, p_note, p_actor,
      'assignment', v_previous_assignee, p_assignee_id
    );
  else
    if p_assignee_id is null
       or not exists (
         select 1 from public.staff_hierarchy h
         join public.staff_profiles manager on manager.user_id = h.reports_to_user_id
         where h.staff_user_id = p_actor
           and h.reports_to_user_id = p_assignee_id
           and h.department_id = v_complaint.department_id
           and manager.active and manager.approved and not manager.force_password_change
           and (
             manager.is_main_system_admin
             or (
               exists (
                 select 1
                 from public.staff_ward_assignments swa
                 join public.wards w on w.id = swa.ward_id and w.is_active
                 where swa.staff_user_id = manager.user_id
                   and swa.ward_id = v_complaint.ward_id
               )
               and public.staff_user_has_complaint_permission(
                 manager.user_id,
                 v_complaint.department_id,
                 v_complaint.ward_id,
                 'complaints.read'
               )
             )
           )
       ) then
      raise exception using errcode = '22023', message = 'Escalation target must be the configured reporting officer';
    end if;
    update public.complaint_assignments
    set unassigned_at = pg_catalog.now()
    where complaint_id = p_complaint_id and unassigned_at is null;
    insert into public.complaint_assignments (
      complaint_id, staff_user_id, assigned_by
    ) values (p_complaint_id, p_assignee_id, p_actor);
    insert into public.complaint_status_history (
      complaint_id, previous_status, new_status, note, changed_by,
      event_type, previous_assignee_id, new_assignee_id
    ) values (
      p_complaint_id, v_complaint.status, v_complaint.status, p_note, p_actor,
      'escalation', v_previous_assignee, p_assignee_id
    );
  end if;

  return jsonb_build_object('id', p_complaint_id, 'status', (
    select c.status from public.complaints c where c.id = p_complaint_id
  ));
end;
$$;

create or replace function public.audit_staff_password_reset_request(
  p_actor uuid,
  p_staff_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.staff_profiles
    where user_id = p_actor
      and is_main_system_admin
      and role = 'administrator'
      and active and approved and not force_password_change
  ) then
    raise exception using errcode = '42501', message = 'Main system administrator authorization required';
  end if;
  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id)
  select p_actor, 'staff.password_reset_requested', 'staff_profile', p_staff_user_id::text
  where exists (select 1 from public.staff_profiles where user_id = p_staff_user_id);
  if not found then
    raise exception using errcode = 'P0002', message = 'Staff profile not found';
  end if;
end;
$$;

alter table public.staff_hierarchy enable row level security;
alter table public.staff_permissions enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on public.staff_hierarchy, public.staff_permissions, public.admin_audit_logs
  from public, anon, authenticated;
grant select on public.staff_hierarchy, public.staff_permissions, public.admin_audit_logs
  to authenticated;

create policy "read own staff hierarchy"
on public.staff_hierarchy for select to authenticated
using (staff_user_id = (select auth.uid()) or reports_to_user_id = (select auth.uid()));

create policy "read own staff permissions"
on public.staff_permissions for select to authenticated
using (staff_user_id = (select auth.uid()));

create policy "main administrator reads audit logs"
on public.admin_audit_logs for select to authenticated
using (public.is_main_system_administrator());

revoke all on function public.is_main_system_administrator() from public, anon;
revoke all on function public.is_authorized_administrator() from public, anon;
revoke all on function public.staff_has_complaint_permission(uuid, uuid, text) from public, anon;
revoke all on function public.staff_user_has_complaint_permission(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.staff_authorized_for_complaint(uuid, uuid) from public, anon;
revoke all on function public.manage_staff_directory(uuid, text, uuid, jsonb, uuid[], jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.manage_complaint(uuid, text, uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.audit_staff_password_reset_request(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_main_system_administrator() to authenticated;
grant execute on function public.is_authorized_administrator() to authenticated;
grant execute on function public.staff_has_complaint_permission(uuid, uuid, text) to authenticated;
grant execute on function public.staff_authorized_for_complaint(uuid, uuid) to authenticated;
grant execute on function public.staff_user_has_complaint_permission(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.manage_complaint(uuid, text, uuid, text, text, uuid, uuid) to service_role;
grant execute on function public.audit_staff_password_reset_request(uuid, uuid) to service_role;
grant execute on function public.manage_staff_directory(uuid, text, uuid, jsonb, uuid[], jsonb, uuid)
  to service_role;

commit;
