-- Enable a department-independent global Main System Administrator.
-- Apply manually after 20261106_005_staff_designations_and_roles.sql.
begin;

alter table public.staff_profiles
  alter column department_id drop not null;

alter table public.staff_profiles
  add constraint staff_profiles_department_scope_check
  check (
    (is_main_system_admin and role = 'administrator')
    or (not is_main_system_admin and department_id is not null)
  );

create table public.system_settings (
  key text primary key
    check (key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  value jsonb not null,
  description text
    check (description is null or char_length(description) <= 500),
  updated_by uuid not null
    references public.staff_profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger system_settings_updated
before update on public.system_settings
for each row execute procedure public.set_updated_at();

alter table public.system_settings enable row level security;
revoke all on public.system_settings from public, anon, authenticated;
grant select on public.system_settings to authenticated;

create policy "main administrator reads all wards"
on public.wards for select to authenticated
using (public.is_main_system_administrator());

create policy "main administrator reads staff profiles"
on public.staff_profiles for select to authenticated
using (public.is_main_system_administrator());

create policy "main administrator reads ward assignments"
on public.staff_ward_assignments for select to authenticated
using (public.is_main_system_administrator());

create policy "main administrator reads staff hierarchy"
on public.staff_hierarchy for select to authenticated
using (public.is_main_system_administrator());

create policy "main administrator reads staff permissions"
on public.staff_permissions for select to authenticated
using (public.is_main_system_administrator());

create policy "main administrator reads all designations"
on public.staff_designations for select to authenticated
using (public.is_main_system_administrator());

create policy "main administrator reads system settings"
on public.system_settings for select to authenticated
using (public.is_main_system_administrator());

create or replace function public.manage_department(
  p_actor uuid,
  p_action text,
  p_department_id uuid default null,
  p_code text default null,
  p_name text default null,
  p_name_mr text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_name_mr text := nullif(btrim(coalesce(p_name_mr, '')), '');
begin
  if not exists (
    select 1
    from public.staff_profiles
    where user_id = p_actor
      and is_main_system_admin
      and role = 'administrator'
      and active
      and approved
      and not force_password_change
  ) then
    raise exception using errcode = '42501', message = 'Main System Administrator authorization required';
  end if;

  if p_action is null
     or p_action not in ('create', 'update')
     or v_code !~ '^[A-Z0-9_]{2,32}$'
     or char_length(v_name) not between 2 and 120
     or (v_name_mr is not null and char_length(v_name_mr) > 180) then
    raise exception using errcode = '22023', message = 'Provide a valid department code and name';
  end if;

  if p_action = 'create' then
    insert into public.departments (code, name, name_mr)
    values (v_code, v_name, v_name_mr)
    returning id into v_id;
  else
    select to_jsonb(d) into v_before
    from public.departments d
    where d.id = p_department_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Department not found';
    end if;

    update public.departments
    set code = v_code,
        name = v_name,
        name_mr = v_name_mr
    where id = p_department_id;
    v_id := p_department_id;
  end if;

  select to_jsonb(d) into v_after
  from public.departments d
  where d.id = v_id;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, details)
  values (
    p_actor,
    'department.' || p_action,
    'department',
    v_id::text,
    jsonb_build_object('before', v_before, 'after', v_after)
  );
  return v_after;
end;
$$;

create or replace function public.manage_system_setting(
  p_actor uuid,
  p_action text,
  p_key text,
  p_value jsonb default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if not exists (
    select 1
    from public.staff_profiles
    where user_id = p_actor
      and is_main_system_admin
      and role = 'administrator'
      and active
      and approved
      and not force_password_change
  ) then
    raise exception using errcode = '42501', message = 'Main System Administrator authorization required';
  end if;

  if p_key is null
     or p_key !~ '^[a-z][a-z0-9_.-]{0,99}$'
     or p_action is null
     or p_action not in ('upsert', 'delete') then
    raise exception using errcode = '22023', message = 'Provide a valid system setting key and action';
  end if;

  select to_jsonb(s) into v_before
  from public.system_settings s
  where s.key = p_key
  for update;

  if p_action = 'upsert' then
    if p_value is null
       or pg_catalog.octet_length(p_value::text) > 65536
       or (v_description is not null and char_length(v_description) > 500) then
      raise exception using errcode = '22023', message = 'Provide a JSON value up to 64 KiB and a description up to 500 characters';
    end if;
    insert into public.system_settings (key, value, description, updated_by)
    values (p_key, p_value, v_description, p_actor)
    on conflict (key) do update
    set value = excluded.value,
        description = excluded.description,
        updated_by = excluded.updated_by;

    select to_jsonb(s) into v_after
    from public.system_settings s
    where s.key = p_key;
  else
    if v_before is null then
      raise exception using errcode = 'P0002', message = 'System setting not found';
    end if;
    delete from public.system_settings where key = p_key;
  end if;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, details)
  values (
    p_actor,
    'system_setting.' || p_action,
    'system_setting',
    p_key,
    jsonb_build_object('before', v_before, 'after', v_after)
  );
  return coalesce(v_after, v_before, '{}'::jsonb);
end;
$$;

create or replace function public.bootstrap_main_system_administrator(
  p_user_id uuid,
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_profile jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Server-side administrator bootstrap required';
  end if;

  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'Provide a full name between 2 and 100 characters';
  end if;

  select u.phone into v_phone
  from auth.users u
  where u.id = p_user_id
    and u.phone_confirmed_at is not null
    and u.raw_app_meta_data ->> 'account_type' = 'staff'
  for key share;

  if not found or v_phone is null or v_phone !~ '^[+]91[6-9][0-9]{9}$' then
    raise exception using errcode = '22023', message = 'Auth user must have trusted staff metadata and a confirmed Indian phone';
  end if;
  if exists (
    select 1 from public.staff_profiles
    where is_main_system_admin
  ) then
    raise exception using errcode = '23505', message = 'A Main System Administrator is already configured';
  end if;
  if exists (
    select 1 from public.staff_profiles
    where user_id = p_user_id
       or mobile_e164 = v_phone
       or official_contact_number = v_phone
  ) then
    raise exception using errcode = '23505', message = 'This Auth user or phone already has a staff profile';
  end if;

  insert into public.staff_profiles (
    user_id,
    department_id,
    mobile_e164,
    official_contact_number,
    role,
    active,
    approved,
    force_password_change,
    is_main_system_admin,
    full_name_en,
    designation_en
  )
  values (
    p_user_id,
    null,
    v_phone,
    v_phone,
    'administrator',
    true,
    true,
    false,
    true,
    btrim(p_full_name),
    'Developer / Main System Administrator'
  );
  select to_jsonb(sp) into v_profile
  from public.staff_profiles sp
  where sp.user_id = p_user_id;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, details)
  values (
    p_user_id,
    'system.main_administrator_bootstrapped',
    'staff_profile',
    p_user_id::text,
    jsonb_build_object('department_id', null, 'is_main_system_admin', true)
  );

  return v_profile;
end;
$$;

revoke all on function public.manage_department(uuid, text, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.manage_system_setting(uuid, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.bootstrap_main_system_administrator(uuid, text)
  from public, anon, authenticated;
grant execute on function public.manage_department(uuid, text, uuid, text, text, text)
  to service_role;
grant execute on function public.manage_system_setting(uuid, text, text, jsonb, text)
  to service_role;
grant execute on function public.bootstrap_main_system_administrator(uuid, text)
  to service_role;

commit;
