import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createApp } from '../src/app.js'

test('email-session verification grants access only to Main System Administrators', async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = Object.fromEntries([
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
    'NODE_ENV',
  ].map(key => [key, process.env[key]]))
  let profileKind = 'administrator'
  let userLookups = 0

  process.env.SUPABASE_URL = 'https://project-ref.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  process.env.SUPABASE_SECRET_KEY = 'test-server-secret'
  process.env.NODE_ENV = 'test'

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input)
    if (url.pathname === '/auth/v1/user') {
      userLookups += 1
      assert.equal(options.headers.apikey, 'test-publishable-key')
      assert.equal(options.headers.authorization, 'Bearer signed-in-user-token')
      return Response.json({
        id: 'auth-user-test',
        email: 'account@example.test',
        email_confirmed_at: 'confirmed',
      })
    }

    if (url.pathname === '/auth/v1/token') {
      return Response.json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'auth-user-test' },
      })
    }

    if (url.pathname === '/rest/v1/staff_profiles') {
      if (profileKind === 'citizen') return Response.json([])
      const administrator = profileKind === 'administrator'
      return Response.json([{
        user_id: 'auth-user-test',
        department_id: administrator ? null : 'department-test',
        role: administrator ? 'administrator' : 'assigned_staff',
        active: true,
        approved: true,
        force_password_change: false,
        is_main_system_admin: administrator,
        mobile_e164: '+919876543210',
        staff_id: 'test-staff',
      }])
    }

    if (url.pathname === '/rest/v1/staff_ward_assignments') {
      return Response.json([{
        ward_id: 'ward-test',
        ward: { id: 'ward-test', ward_number: 6, ward_name: 'Test Ward', is_active: true },
      }])
    }
    if (url.pathname === '/rest/v1/staff_permissions') {
      return Response.json([{
        permission_code: 'complaints.read',
        department_id: 'department-test',
        ward_id: 'ward-test',
      }])
    }
    if (url.pathname === '/rest/v1/staff_hierarchy') return Response.json([])
    throw new Error(`Unexpected mocked Supabase path: ${url.pathname}`)
  }

  const server = createServer(createApp())
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`

    async function verifyAdmin(path = '/api/staff-auth/admin-login') {
      return originalFetch(`${origin}${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer signed-in-user-token' },
      })
    }

    const adminResponse = await verifyAdmin()
    assert.equal(adminResponse.status, 200)
    const adminData = await adminResponse.json()
    assert.equal(adminData.staff.role, 'administrator')
    assert.equal(adminData.staff.is_main_system_admin, true)
    assert.equal(adminData.staff.department_id, null)

    profileKind = 'ordinary_staff'
    const staffResponse = await verifyAdmin()
    assert.equal(staffResponse.status, 401)
    assert.deepEqual(await staffResponse.json(), { message: 'Unable to sign in with those credentials.' })
    const municipalStaffLogin = await originalFetch(`${origin}/api/staff-auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobile: '9876543210', password: 'test-only-password' }),
    })
    assert.equal(municipalStaffLogin.status, 200)

    profileKind = 'citizen'
    const citizenResponse = await verifyAdmin()
    assert.equal(citizenResponse.status, 401)
    assert.deepEqual(await citizenResponse.json(), { message: 'Unable to sign in with those credentials.' })

    profileKind = 'citizen'
    const callsBeforeRateLimit = userLookups
    let rateLimitedResponse
    for (let attempt = 0; attempt < 11; attempt += 1) {
      rateLimitedResponse = await verifyAdmin()
    }
    assert.equal(rateLimitedResponse.status, 429)
    assert.equal(userLookups - callsBeforeRateLimit, 7)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
