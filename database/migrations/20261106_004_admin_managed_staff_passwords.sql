-- Enable administrator-managed staff passwords without SMS or email recovery.
-- Apply after 20261106_003_staff_management.sql.
begin;

create or replace function public.set_staff_password_ready(
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

  update public.staff_profiles
  set force_password_change = false,
      updated_at = pg_catalog.now()
  where user_id = p_staff_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Staff profile not found';
  end if;

  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id)
  values (p_actor, 'staff.password_set_by_administrator', 'staff_profile', p_staff_user_id::text);
end;
$$;

revoke all on function public.set_staff_password_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_staff_password_ready(uuid, uuid) to service_role;

commit;
