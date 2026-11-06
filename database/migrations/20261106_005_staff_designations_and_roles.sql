-- Add configurable municipal designations and the requested staff role labels.
-- Apply after 20261106_004_admin_managed_staff_passwords.sql.
begin;

update public.departments
set name_mr = 'पाणी पुरवठा व मलनिस्सारण विभाग'
where code = 'WATER_DRAINAGE';

alter table public.staff_profiles
  drop constraint if exists staff_profiles_role_check;

alter table public.staff_profiles
  add constraint staff_profiles_role_check
  check (role in (
    'staff',
    'supervisor',
    'administrator',
    'department_head',
    'supervising_officer',
    'junior_section_officer',
    'assigned_staff'
  ));

create table if not exists public.staff_designations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null
    references public.departments(id) on delete cascade,
  name_mr text,
  name_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (nullif(btrim(name_mr), '') is not null or nullif(btrim(name_en), '') is not null),
  check (name_mr is null or char_length(name_mr) <= 180),
  check (name_en is null or char_length(name_en) <= 180)
);

create unique index if not exists staff_designations_department_mr_unique
  on public.staff_designations (department_id, lower(name_mr))
  where name_mr is not null;
create unique index if not exists staff_designations_department_en_unique
  on public.staff_designations (department_id, lower(name_en))
  where name_en is not null;
create index if not exists staff_designations_active_department_idx
  on public.staff_designations (department_id, is_active, name_en);

alter table public.staff_profiles
  add column if not exists designation_id uuid
    references public.staff_designations(id) on delete set null;

create or replace function public.sync_staff_designation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name_mr text;
  v_name_en text;
begin
  if new.designation_id is null then
    return new;
  end if;

  select d.name_mr, d.name_en
    into v_name_mr, v_name_en
  from public.staff_designations d
  where d.id = new.designation_id
    and d.department_id = new.department_id
    and d.is_active;

  if not found then
    new.designation_id := null;
    return new;
  end if;

  new.designation_mr := v_name_mr;
  new.designation_en := v_name_en;
  return new;
end;
$$;

create trigger staff_profiles_sync_designation
before insert or update of designation_id, department_id
on public.staff_profiles
for each row execute procedure public.sync_staff_designation();

drop trigger if exists staff_designations_updated on public.staff_designations;
create trigger staff_designations_updated
before update on public.staff_designations
for each row execute procedure public.set_updated_at();

alter table public.staff_designations enable row level security;
revoke all on public.staff_designations from public, anon, authenticated;
grant select on public.staff_designations to authenticated;

create policy "read active staff designations"
on public.staff_designations for select to authenticated
using (is_active);

create or replace function public.manage_staff_designation(
  p_actor uuid,
  p_action text,
  p_designation_id uuid default null,
  p_department_id uuid default null,
  p_name_mr text default null,
  p_name_en text default null,
  p_is_active boolean default true
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
    raise exception using errcode = '42501', message = 'Main system administrator authorization required';
  end if;

  if p_action = 'create' then
    if p_department_id is null
       or (nullif(btrim(p_name_mr), '') is null and nullif(btrim(p_name_en), '') is null)
       or char_length(coalesce(p_name_mr, '')) > 180
       or char_length(coalesce(p_name_en, '')) > 180 then
      raise exception using errcode = '22023', message = 'Provide a department and at least one valid designation name';
    end if;
    insert into public.staff_designations (department_id, name_mr, name_en)
    values (p_department_id, nullif(btrim(p_name_mr), ''), nullif(btrim(p_name_en), ''))
    returning id into v_id;
  elsif p_action in ('update', 'set_active') then
    select to_jsonb(d) into v_before
    from public.staff_designations d
    where d.id = p_designation_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Staff designation not found';
    end if;

    if p_action = 'update' then
      if p_department_id is null
         or (nullif(btrim(p_name_mr), '') is null and nullif(btrim(p_name_en), '') is null)
         or char_length(coalesce(p_name_mr, '')) > 180
         or char_length(coalesce(p_name_en, '')) > 180 then
        raise exception using errcode = '22023', message = 'Provide a department and at least one valid designation name';
      end if;
      if (v_before ->> 'department_id')::uuid is distinct from p_department_id
         and exists (
           select 1 from public.staff_profiles
           where designation_id = p_designation_id
         ) then
        raise exception using errcode = '23514', message = 'A designation linked to staff profiles cannot be moved to another department';
      end if;
      update public.staff_designations
      set department_id = p_department_id,
          name_mr = nullif(btrim(p_name_mr), ''),
          name_en = nullif(btrim(p_name_en), ''),
          is_active = p_is_active
      where id = p_designation_id;
    else
      update public.staff_designations
      set is_active = p_is_active
      where id = p_designation_id;
    end if;
    v_id := p_designation_id;
  else
    raise exception using errcode = '22023', message = 'Unsupported designation management action';
  end if;

  select to_jsonb(d) into v_after
  from public.staff_designations d
  where d.id = v_id;

  if p_action = 'update' then
    update public.staff_profiles
    set designation_mr = nullif(v_after ->> 'name_mr', ''),
        designation_en = nullif(v_after ->> 'name_en', ''),
        updated_at = pg_catalog.now()
    where designation_id = v_id;
  end if;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, details)
  values (
    p_actor,
    'staff_designation.' || p_action,
    'staff_designation',
    v_id::text,
    jsonb_build_object('before', v_before, 'after', v_after)
  );
  return v_after;
end;
$$;

revoke all on function public.sync_staff_designation() from public, anon, authenticated;
revoke all on function public.manage_staff_designation(uuid, text, uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.manage_staff_designation(uuid, text, uuid, uuid, text, text, boolean)
  to service_role;

commit;
