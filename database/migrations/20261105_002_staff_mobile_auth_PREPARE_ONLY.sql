-- PREPARE ONLY: review and apply manually to a non-production Supabase project first.
-- This migration is intentionally not applied by the application.
-- Auth users must be created by an administrator with auth.admin.createUser({ phone, password,
-- phone_confirm: true }); never create a fake email address from a mobile number.

alter table public.staff_profiles
  add column if not exists mobile_e164 text,
  add column if not exists approved boolean not null default false,
  add column if not exists force_password_change boolean not null default true;

alter table public.staff_profiles
  add constraint staff_profiles_mobile_e164_india_check
  check (mobile_e164 is null or mobile_e164 ~ '^[+]91[6-9][0-9]{9}$') not valid;
alter table public.staff_profiles validate constraint staff_profiles_mobile_e164_india_check;
create unique index if not exists staff_profiles_mobile_e164_unique
  on public.staff_profiles (mobile_e164) where mobile_e164 is not null;

-- Backfill mobile_e164 and approval state only through a verified administrator workflow,
-- then make the column NOT NULL in a later migration. Do not infer it from citizen profiles.

create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = auth.uid() and active = true and approved = true
      and force_password_change = false
  )
$$;

create or replace function public.can_access_department(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = auth.uid() and active = true and approved = true
      and force_password_change = false
      and (role = 'administrator' or department_id = target)
  )
$$;

-- Ward-level authorization is not present in the current schema. Before enabling a staff
-- dashboard for ward-scoped complaints, add wards and an explicit staff-to-ward permission
-- table, backfill every complaint with a ward, and replace staff complaint/storage policies
-- with a function that checks department *and* ward. Do not grant dashboard access first.
