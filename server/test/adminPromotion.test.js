import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createApp } from '../src/app.js'

test('only an authenticated confirmed citizen can atomically promote its existing Auth UUID', async () => {
  const originalFetch = globalThis.fetch
  const envKeys = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'ADMIN_SETUP_KEY', 'NODE_ENV']
  const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  const calls = []
  const identities = {
    'citizen-token-1': { id: 'citizen-user-1', email: 'citizen@example.test', email_confirmed_at: 'confirmed' },
    'citizen-token-2': { id: 'citizen-user-2', email: 'second@example.test', email_confirmed_at: 'confirmed' },
    'unconfirmed-token': { id: 'unconfirmed-user', email: 'unconfirmed@example.test', email_confirmed_at: null },
    'staff-token': { id: 'staff-user', email: 'staff@example.test', email_confirmed_at: 'confirmed' },
  }
  let state = { setup_completed: false, setup_claim_id: null }
  let promotedUserId = null
  let claimedId = null

  process.env.SUPABASE_URL = 'https://project-ref.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  process.env.SUPABASE_SECRET_KEY = 'test-server-secret'
  process.env.ADMIN_SETUP_KEY = 'test-setup-key-with-at-least-32-characters'
  process.env.NODE_ENV = 'test'

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input)
    calls.push({ path: url.pathname, options })
    if (url.pathname === '/auth/v1/user') {
      assert.equal(options.headers.apikey, 'test-publishable-key')
      return identities[options.headers.authorization.replace('Bearer ', '')]
        ? Response.json(identities[options.headers.authorization.replace('Bearer ', '')])
        : Response.json({ message: 'invalid token' }, { status: 401 })
    }
    if (url.pathname === '/rest/v1/main_admin_setup_state') return Response.json([state])
    if (url.pathname === '/rest/v1/rpc/claim_main_system_administrator_setup') {
      const { p_claim_id: claimId } = JSON.parse(options.body)
      if (state.setup_completed || state.setup_claim_id) {
        return Response.json({ code: '23505', message: 'Setup closed or in progress' }, { status: 409 })
      }
      state = { ...state, setup_claim_id: claimId }
      claimedId = claimId
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/rest/v1/rpc/release_main_system_administrator_setup') {
      const { p_claim_id: claimId } = JSON.parse(options.body)
      if (state.setup_claim_id === claimId) state = { ...state, setup_claim_id: null }
      return Response.json(true)
    }
    if (url.pathname === '/rest/v1/rpc/promote_citizen_to_main_system_administrator') {
      const body = JSON.parse(options.body)
      assert.equal(options.headers.authorization, 'Bearer test-server-secret')
      if (body.p_user_id !== identities['citizen-token-1'].id) {
        return Response.json({ code: '22023', message: 'A confirmed email Auth account with an existing citizen profile is required' }, { status: 400 })
      }
      assert.equal(body.p_user_id, identities['citizen-token-1'].id)
      assert.equal(body.p_claim_id, claimedId)
      assert.equal(body.password, undefined)
      promotedUserId = body.p_user_id
      state = {
        setup_completed: true,
        setup_claim_id: null,
        initial_admin_user_id: body.p_user_id,
      }
      return Response.json({
        user_id: body.p_user_id,
        role: 'administrator',
        is_main_system_admin: true,
        department_id: null,
      })
    }
    if (url.pathname === '/rest/v1/staff_profiles') {
      return Response.json(promotedUserId
        ? [{
            user_id: promotedUserId,
            role: 'administrator',
            is_main_system_admin: true,
            department_id: null,
            active: true,
            approved: true,
            force_password_change: false,
          }]
        : [])
    }
    throw new Error(`Unexpected mocked Supabase path: ${url.pathname}`)
  }

  const app = createApp()
  app.set('trust proxy', true)
  const server = createServer(app)
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`

    async function promote(token, setupKey, forwardedFor = '192.0.2.1') {
      return originalFetch(`${origin}/api/staff-auth/admin-promote`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-forwarded-for': forwardedFor,
        },
        body: JSON.stringify({ setupKey }),
      })
    }

    const invalidKey = await promote('citizen-token-1', 'incorrect-private-key')
    assert.equal(invalidKey.status, 403)
    assert.equal(calls.length, 0)

    const unauthenticated = await promote('invalid-token', process.env.ADMIN_SETUP_KEY)
    assert.equal(unauthenticated.status, 401)
    assert.equal(calls.filter(call => call.path.includes('/rpc/')).length, 0)

    const unconfirmed = await promote('unconfirmed-token', process.env.ADMIN_SETUP_KEY, '192.0.2.2')
    assert.equal(unconfirmed.status, 401)

    const staffAttempt = await promote('staff-token', process.env.ADMIN_SETUP_KEY, '192.0.2.3')
    assert.equal(staffAttempt.status, 403)

    const success = await promote('citizen-token-1', process.env.ADMIN_SETUP_KEY, '192.0.2.4')
    assert.equal(success.status, 200)
    assert.equal((await success.json()).message.includes('existing account'), true)
    assert.equal(promotedUserId, identities['citizen-token-1'].id)
    assert.equal(state.setup_completed, true)
    const promotionRequest = calls.find(call =>
      call.path === '/rest/v1/rpc/promote_citizen_to_main_system_administrator' &&
      JSON.parse(call.options.body).p_user_id === identities['citizen-token-1'].id,
    )
    assert.ok(promotionRequest)
    assert.deepEqual(JSON.parse(promotionRequest.options.body), {
      p_user_id: identities['citizen-token-1'].id,
      p_claim_id: claimedId,
    })

    const second = await promote('citizen-token-2', process.env.ADMIN_SETUP_KEY, '192.0.2.5')
    assert.equal(second.status, 409)
    assert.equal(promotedUserId, identities['citizen-token-1'].id)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('missing setup-state rows are rejected as a migration gap before promotion is allowed', async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'ADMIN_SETUP_KEY', 'NODE_ENV']
    .map(key => [key, process.env[key]]))

  process.env.SUPABASE_URL = 'https://project-ref.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  process.env.SUPABASE_SECRET_KEY = 'test-server-secret'
  process.env.ADMIN_SETUP_KEY = 'test-setup-key-with-at-least-32-characters'
  process.env.NODE_ENV = 'test'

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input)
    if (url.pathname === '/auth/v1/user') {
      return Response.json({ id: 'citizen-user-3', email: 'missing-state@example.test', email_confirmed_at: 'confirmed' })
    }
    if (url.pathname === '/rest/v1/main_admin_setup_state') {
      return Response.json([])
    }
    throw new Error(`Unexpected mocked Supabase path: ${url.pathname}`)
  }

  const app = createApp()
  app.set('trust proxy', true)
  const server = createServer(app)
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/staff-auth/admin-setup/status`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      available: false,
      reason: 'DATABASE_MIGRATION_REQUIRED',
      message: 'Backend could not verify administrator setup. Check migrations and backend logs.',
    })
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('two simultaneous promotion requests cannot both claim setup', async () => {
  const originalFetch = globalThis.fetch
  const envKeys = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'ADMIN_SETUP_KEY', 'NODE_ENV']
  const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  let state = { setup_completed: false, setup_claim_id: null }
  const promotedIds = []
  const identities = {
    'first-token': { id: 'first-citizen', email: 'first@example.test', email_confirmed_at: 'confirmed' },
    'second-token': { id: 'second-citizen', email: 'second@example.test', email_confirmed_at: 'confirmed' },
  }

  process.env.SUPABASE_URL = 'https://project-ref.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  process.env.SUPABASE_SECRET_KEY = 'test-server-secret'
  process.env.ADMIN_SETUP_KEY = 'test-setup-key-with-at-least-32-characters'
  process.env.NODE_ENV = 'test'
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input)
    if (url.pathname === '/auth/v1/user') {
      return Response.json(identities[options.headers.authorization.replace('Bearer ', '')])
    }
    if (url.pathname === '/rest/v1/main_admin_setup_state') return Response.json([state])
    if (url.pathname === '/rest/v1/rpc/claim_main_system_administrator_setup') {
      const { p_claim_id: claimId } = JSON.parse(options.body)
      if (state.setup_completed || state.setup_claim_id) {
        return Response.json({ code: '23505', message: 'Setup closed or in progress' }, { status: 409 })
      }
      state = { ...state, setup_claim_id: claimId }
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/rest/v1/rpc/promote_citizen_to_main_system_administrator') {
      const body = JSON.parse(options.body)
      promotedIds.push(body.p_user_id)
      state = {
        setup_completed: true,
        setup_claim_id: null,
        initial_admin_user_id: body.p_user_id,
      }
      return Response.json({
        user_id: body.p_user_id,
        role: 'administrator',
        is_main_system_admin: true,
        department_id: null,
      })
    }
    throw new Error(`Unexpected mocked Supabase path: ${url.pathname}`)
  }

  const app = createApp()
  app.set('trust proxy', true)
  const server = createServer(app)
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    async function promote(token, ip) {
      return originalFetch(`${origin}/api/staff-auth/admin-promote`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ setupKey: process.env.ADMIN_SETUP_KEY }),
      })
    }
    const responses = await Promise.all([
      promote('first-token', '192.0.2.10'),
      promote('second-token', '192.0.2.11'),
    ])
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
    assert.equal(promotedIds.length, 1)
    assert.equal(state.setup_completed, true)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
