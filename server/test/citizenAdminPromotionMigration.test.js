import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const migrationPath = fileURLToPath(new URL('../../database/migrations/20261106_008_main_admin_citizen_promotion.sql', import.meta.url))
const migration = await readFile(migrationPath, 'utf8')

test('citizen promotion preserves Auth identity and enforces a single atomic global admin', () => {
  assert.match(migration, /alter column mobile_e164 drop not null/i)
  assert.match(migration, /alter column official_contact_number drop not null/i)
  assert.match(migration, /function public\.promote_citizen_to_main_system_administrator/i)
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/i)
  assert.match(migration, /select s\.setup_completed, s\.setup_claim_id[\s\S]*?for update/i)
  assert.match(migration, /join public\.profiles p on p\.id = u\.id/i)
  assert.match(migration, /u\.email_confirmed_at is not null/i)
  assert.match(migration, /where user_id = p_user_id[\s\S]*?staff profile/i)
  assert.match(migration, /role,[\s\S]*?is_main_system_admin,[\s\S]*?'administrator'[\s\S]*?true/i)
  assert.match(migration, /values \(\s*p_user_id,\s*null,\s*null,\s*null,[\s\S]*?'administrator'/i)
  assert.match(migration, /initial_admin_user_id = p_user_id[\s\S]*?setup_claim_id = null/i)
  assert.match(migration, /system\.main_administrator_promoted/i)
  assert.match(migration, /grant execute on function public\.promote_citizen_to_main_system_administrator\(uuid, uuid\)\s+to service_role/i)
  assert.doesNotMatch(migration, /auth\.users[\s\S]{0,100}(update|delete)\s+auth\.users/i)
})
