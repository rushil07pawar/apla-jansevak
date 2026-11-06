import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const migrationPath = fileURLToPath(new URL('../../database/migrations/20261106_007_permanent_main_admin_setup.sql', import.meta.url))
const repairMigrationPath = fileURLToPath(new URL('../../database/migrations/20261106_009_main_admin_setup_repair.sql', import.meta.url))
const migration = await readFile(migrationPath, 'utf8')
const repairMigration = await readFile(repairMigrationPath, 'utf8')

test('Main System Administrator setup is serialized and permanently latched in the database', () => {
  assert.match(migration, /create table public\.main_admin_setup_state/i)
  assert.match(migration, /setup_completed boolean not null default false/i)
  assert.match(migration, /initial_admin_user_id uuid,/i)
  assert.match(migration, /create unique index if not exists staff_profiles_single_main_admin[\s\S]*?where is_main_system_admin/i)
  assert.match(migration, /function public\.claim_main_system_administrator_setup[\s\S]*?for update/i)
  assert.match(migration, /function public\.bootstrap_main_system_administrator[\s\S]*?for update/i)
  assert.match(migration, /setup_completed = true[\s\S]*?initial_admin_user_id = p_user_id/i)
  assert.match(migration, /join public\.profiles p on p\.id = u\.id/i)
  assert.match(migration, /u\.email_confirmed_at is not null/i)
  assert.match(migration, /revoke all on function public\.bootstrap_main_system_administrator\(uuid, text, uuid\)[\s\S]*?grant execute on function public\.bootstrap_main_system_administrator\(uuid, text, uuid\)\s+to service_role/i)
  assert.doesNotMatch(migration, /raw_app_meta_data ->> 'account_type' = 'staff'/i)
  assert.doesNotMatch(migration, /u\.phone_confirmed_at is not null/i)
})

test('setup-state repair initializes a missing row and keeps the citizen-based bootstrap flow idempotent', () => {
  assert.match(repairMigration, /insert into public\.main_admin_setup_state[\s\S]*?on conflict \(singleton\) do nothing/i)
  assert.match(repairMigration, /A confirmed email Auth account with an existing citizen profile is required/i)
  assert.match(repairMigration, /join public\.profiles p on p\.id = u\.id/i)
  assert.match(repairMigration, /This account already has a staff profile/i)
  assert.match(repairMigration, /grant execute on function public\.bootstrap_main_system_administrator\(uuid, text, uuid\)\s+to service_role/i)
})
