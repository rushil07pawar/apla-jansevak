-- Persist one-time Main System Administrator setup completion independently
-- of the administrator profile so deletion/deactivation cannot reopen setup.
begin;

create table public.main_admin_setup_state (
  singleton boolean primary key default true check (singleton),
  setup_completed boolean not null default false,
  completed_at timestamptz,
  initial_admin_user_id uuid,
  setup_claim_id uuid,
  setup_claimed_at timestamptz,
  check (
    (setup_completed and completed_at is not null and initial_admin_user_id is not null
      and setup_claim_id is null and setup_claimed_at is null)
    or (not setup_completed and completed_at is null and initial_admin_user_id is null
      and ((setup_claim_id is null and setup_claimed_at is null)
        or (setup_claim_id is not null and setup_claimed_at is not null)))
  )
);

insert into public.main_admin_setup_state (
  singleton,
  setup_completed,
  completed_at,
  initial_admin_user_id
)
select
  true,
  exists (select 1 from public.staff_profiles where is_main_system_admin),
  case when exists (select 1 from public.staff_profiles where is_main_system_admin) then now() else null end,
  (select user_id from public.staff_profiles where is_main_system_admin limit 1)
on conflict (singleton) do nothing;

alter table public.main_admin_setup_state enable row level security;
revoke all on public.main_admin_setup_state from public, anon, authenticated;
grant select on public.main_admin_setup_state to service_role;

create unique index if not exists staff_profiles_single_main_admin
  on public.staff_profiles (is_main_system_admin)
  where is_main_system_admin;

drop function if exists public.bootstrap_main_system_administrator(uuid, text);

create or replace function public.claim_main_system_administrator_setup(
  p_claim_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setup_completed boolean;
  v_setup_claim_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Server-side administrator setup required';
  end if;
  if p_claim_id is null then
    raise exception using errcode = '22023', message = 'Setup claim is required';
  end if;

  select s.setup_completed, s.setup_claim_id
    into v_setup_completed, v_setup_claim_id
  from public.main_admin_setup_state s
  where s.singleton
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'Administrator setup state is not initialized';
  end if;
  if v_setup_completed or v_setup_claim_id is not null then
    raise exception using errcode = '23505', message = 'Main System Administrator setup is closed or in progress';
  end if;
  if exists (select 1 from public.staff_profiles where is_main_system_admin) then
    raise exception using errcode = '23505', message = 'A Main System Administrator already exists';
  end if;

  update public.main_admin_setup_state
  set setup_claim_id = p_claim_id,
      setup_claimed_at = now()
  where singleton;
end;
$$;

create or replace function public.release_main_system_administrator_setup(
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Server-side administrator setup required';
  end if;

  update public.main_admin_setup_state
  set setup_claim_id = null,
      setup_claimed_at = null
  where singleton
    and not setup_completed
    and setup_claim_id = p_claim_id;
  return found;
end;
$$;

create or replace function public.bootstrap_main_system_administrator(
  p_user_id uuid,
  p_full_name text,
  p_claim_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_profile jsonb;
  v_setup_completed boolean;
  v_setup_claim_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Server-side administrator bootstrap required';
  end if;

  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'Provide a full name between 2 and 100 characters';
  end if;

  select s.setup_completed, s.setup_claim_id
    into v_setup_completed, v_setup_claim_id
  from public.main_admin_setup_state s
  where s.singleton
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'Administrator setup state is not initialized';
  end if;
  if v_setup_completed or v_setup_claim_id is distinct from p_claim_id then
    raise exception using errcode = '23505', message = 'Main System Administrator setup is closed or the claim is invalid';
  end if;

  if p_full_name is null or btrim(p_full_name) = '' then
    select coalesce(p.full_name, split_part(u.email, '@', 1))
      into v_full_name
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.id = p_user_id
      and u.email is not null
      and u.email_confirmed_at is not null;
  else
    v_full_name := btrim(p_full_name);
  end if;

  if v_full_name is null or char_length(v_full_name) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'Provide a valid full name or use the existing citizen profile data';
  end if;
  if not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = p_user_id
      and u.email is not null
      and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = '22023', message = 'A confirmed email Auth account with an existing citizen profile is required';
  end if;
  if exists (
    select 1 from public.staff_profiles
    where is_main_system_admin
  ) then
    raise exception using errcode = '23505', message = 'A Main System Administrator already exists';
  end if;
  if exists (
    select 1 from public.staff_profiles
    where user_id = p_user_id
  ) then
    raise exception using errcode = '23505', message = 'This account already has a staff profile';
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
    null,
    null,
    'administrator',
    true,
    true,
    false,
    true,
    v_full_name,
    'Developer / Main System Administrator'
  );

  select to_jsonb(sp) into v_profile
  from public.staff_profiles sp
  where sp.user_id = p_user_id;

  update public.main_admin_setup_state
  set setup_completed = true,
      completed_at = now(),
      initial_admin_user_id = p_user_id,
      setup_claim_id = null,
      setup_claimed_at = null
  where singleton;

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

revoke all on function public.claim_main_system_administrator_setup(uuid)
  from public, anon, authenticated;
revoke all on function public.release_main_system_administrator_setup(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_main_system_administrator_setup(uuid)
  to service_role;
grant execute on function public.release_main_system_administrator_setup(uuid)
  to service_role;
revoke all on function public.bootstrap_main_system_administrator(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_main_system_administrator(uuid, text, uuid)
  to service_role;

commit;
