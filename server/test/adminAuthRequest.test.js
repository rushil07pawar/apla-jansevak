import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestAuthAdminUser } from '../src/lib/adminAuthRequest.js'
import { createServer } from 'node:http'
import { createApp } from '../src/app.js'

const config = {
  url: 'https://project-ref.supabase.co',
  secretKey: 'server-test-secret',
}
const payload = {
  phone: '+919876543210',
  phone_confirm: true,
  password: 'test-only-password',
  app_metadata: { account_type: 'staff' },
  user_metadata: { full_name: 'Test Administrator' },
}

test('constructs the Supabase Auth Admin request with privileged server headers', async () => {
  let captured
  const { response, host, path } = await requestAuthAdminUser(config, payload, {
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return Response.json({ id: 'auth-user-test' }, { status: 201 })
    },
  })

  assert.equal(captured.url, 'https://project-ref.supabase.co/auth/v1/admin/users')
  assert.equal(captured.options.method, 'POST')
  assert.equal(captured.options.headers.apikey, config.secretKey)
  assert.equal(captured.options.headers.authorization, `Bearer ${config.secretKey}`)
  assert.equal(captured.options.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(captured.options.body), payload)
  assert.equal(host, 'project-ref.supabase.co')
  assert.equal(path, '/auth/v1/admin/users')
  assert.equal(response.status, 201)
})

test('reports DNS failures without exposing the request payload or key', async () => {
  const dnsError = Object.assign(new Error('lookup admin@example.test failed'), { code: 'ENOTFOUND' })
  await assert.rejects(
    requestAuthAdminUser(config, payload, {
      fetchImpl: async () => {
        throw new TypeError('fetch failed', { cause: dnsError })
      },
    }),
    error => {
      assert.equal(error.code, 'AUTH_SERVICE_UNAVAILABLE')
      assert.equal(error.diagnostic.failureType, 'dns')
      assert.equal(error.diagnostic.requestInitiated, true)
      assert.equal(error.diagnostic.httpResponseReceived, false)
      assert.equal(error.diagnostic.status, null)
      assert.equal(error.diagnostic.host, 'project-ref.supabase.co')
      assert.equal(error.diagnostic.path, '/auth/v1/admin/users')
      assert.doesNotMatch(error.diagnostic.exceptionMessage, /admin@example\.test|server-test-secret/)
      return true
    },
  )
})

test('classifies timeout failures separately from network failures', async () => {
  await assert.rejects(
    requestAuthAdminUser(config, payload, {
      fetchImpl: async () => {
        throw new DOMException('request timed out', 'TimeoutError')
      },
    }),
    error => {
      assert.equal(error.diagnostic.failureType, 'timeout')
      return true
    },
  )
})

test('reports invalid URL construction before invoking fetch', async () => {
  let fetchCalled = false
  await assert.rejects(
    requestAuthAdminUser({ ...config, url: 'not-a-url' }, payload, {
      fetchImpl: async () => {
        fetchCalled = true
        return Response.json({})
      },
    }),
    error => {
      assert.equal(error.code, 'AUTH_REQUEST_CONSTRUCTION_FAILED')
      assert.equal(error.diagnostic.failureType, 'request_construction')
      assert.equal(error.diagnostic.requestInitiated, false)
      assert.equal(error.diagnostic.httpResponseReceived, false)
      assert.equal(error.diagnostic.host, null)
      return true
    },
  )
  assert.equal(fetchCalled, false)
})

test('claims setup before creating a phone-only Auth user and bootstraps once', async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    ADMIN_SETUP_KEY: process.env.ADMIN_SETUP_KEY,
    NODE_ENV: process.env.NODE_ENV,
  }
  const calls = []
  let state = { setup_completed: false, setup_claim_id: null }
  let authUserCount = 0
  let bootstrapCount = 0
  process.env.SUPABASE_URL = config.url
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  process.env.SUPABASE_SECRET_KEY = config.secretKey
  process.env.ADMIN_SETUP_KEY = 'test-setup-key-with-at-least-32-characters'
  process.env.NODE_ENV = 'test'
  globalThis.fetch = async (url, options) => {
    const requestUrl = new URL(url)
    const path = requestUrl.pathname
    calls.push(path)
    if (path === '/rest/v1/main_admin_setup_state') return Response.json([state])
    if (path === '/rest/v1/rpc/claim_main_system_administrator_setup') {
      const { p_claim_id: claimId } = JSON.parse(options.body)
      if (state.setup_completed || state.setup_claim_id) {
        return Response.json({ code: '23505', message: 'Main System Administrator setup is closed or in progress' }, { status: 409 })
      }
      state = { ...state, setup_claim_id: claimId }
      return new Response(null, { status: 204 })
    }
    if (path === '/rest/v1/rpc/release_main_system_administrator_setup') {
      const { p_claim_id: claimId } = JSON.parse(options.body)
      if (state.setup_claim_id === claimId) state = { ...state, setup_claim_id: null }
      return Response.json(true)
    }
    if (path === '/auth/v1/admin/users') {
      const request = JSON.parse(options.body)
      assert.equal(request.phone_confirm, true)
      assert.equal(request.app_metadata.account_type, 'staff')
      assert.equal(request.email, undefined)
      assert.equal(request.user_metadata.username, undefined)
      if (request.phone === '+919876543211') {
        return Response.json({ code: 'invalid_api_key', message: 'Invalid API key' }, { status: 401 })
      }
      if (request.phone === '+919876543214') {
        return Response.json({ code: 'weak_password', message: 'Password does not meet requirements' }, { status: 422 })
      }
      if (request.phone === '+919876543216') {
        const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
        throw new TypeError('fetch failed', { cause })
      }
      if (request.phone === '+919876543215') {
        return Response.json({ code: 'user_already_exists', message: 'User already registered' }, { status: 400 })
      }
      authUserCount += 1
      return Response.json({ id: `auth-user-${authUserCount}` }, { status: 201 })
    }
    if (path === '/rest/v1/staff_profiles') return Response.json([])
    if (path === '/rest/v1/rpc/bootstrap_main_system_administrator') {
      const { p_user_id: userId, p_claim_id: claimId } = JSON.parse(options.body)
      assert.equal(state.setup_claim_id, claimId)
      bootstrapCount += 1
      state = {
        setup_completed: true,
        setup_claim_id: null,
        initial_admin_user_id: userId,
      }
      return Response.json({
        user_id: userId,
        department_id: null,
        role: 'administrator',
        is_main_system_admin: true,
      })
    }
    throw new Error(`Unexpected mocked Supabase path: ${path}`)
  }

  const app = createApp()
  app.set('trust proxy', true)
  const server = createServer(app)
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    async function submit(overrides, forwardedFor) {
      return originalFetch(`http://127.0.0.1:${address.port}/api/staff-auth/admin-setup`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': forwardedFor,
        },
        body: JSON.stringify({
        fullName: 'Test Administrator',
        mobile: '9876543210',
        password: 'test-only-password-long',
        confirmPassword: 'test-only-password-long',
        setupKey: process.env.ADMIN_SETUP_KEY,
          ...overrides,
        }),
      })
    }
    const response = await submit({}, '192.0.2.1')

    assert.equal(response.status, 201)
    assert.deepEqual(calls, [
      '/rest/v1/main_admin_setup_state',
      '/rest/v1/rpc/claim_main_system_administrator_setup',
      '/auth/v1/admin/users',
      '/rest/v1/rpc/bootstrap_main_system_administrator',
    ])
    assert.equal(state.setup_completed, true)
    assert.equal(authUserCount, 1)

    calls.length = 0
    const secondRegistration = await submit({ mobile: '9876543219' }, '192.0.2.9')
    assert.equal(secondRegistration.status, 409)
    assert.equal(authUserCount, 1)
    assert.deepEqual(calls, ['/rest/v1/main_admin_setup_state'])
    const statusResponse = await originalFetch(`http://127.0.0.1:${address.port}/api/staff-auth/admin-setup/status`)
    assert.deepEqual(await statusResponse.json(), { available: false, reason: 'closed' })

    calls.length = 0
    state = { setup_completed: false, setup_claim_id: null }
    const invalidKey = await submit({ setupKey: 'wrong-private-key' }, '192.0.2.2')
    assert.equal(invalidKey.status, 403)
    assert.deepEqual(calls, [])
    const missingKey = await submit({ setupKey: '' }, '192.0.2.10')
    assert.equal(missingKey.status, 400)
    assert.deepEqual(calls, [])

    calls.length = 0
    const rejected = await submit({ mobile: '9876543211' }, '192.0.2.3')
    assert.equal(rejected.status, 503)
    assert.equal((await rejected.json()).code, 'AUTH_SERVER_KEY_REJECTED')
    assert.deepEqual(calls, [
      '/rest/v1/main_admin_setup_state',
      '/rest/v1/rpc/claim_main_system_administrator_setup',
      '/auth/v1/admin/users',
      '/rest/v1/rpc/release_main_system_administrator_setup',
    ])

    calls.length = 0
    state = { setup_completed: false, setup_claim_id: null }
    const invalid = await submit({ mobile: '9876543214' }, '192.0.2.4')
    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json()).code, 'AUTH_REQUEST_REJECTED')
    assert.equal(state.setup_claim_id, null)
    assert.deepEqual(calls, [
      '/rest/v1/main_admin_setup_state',
      '/rest/v1/rpc/claim_main_system_administrator_setup',
      '/auth/v1/admin/users',
      '/rest/v1/rpc/release_main_system_administrator_setup',
    ])

    calls.length = 0
    state = { setup_completed: false, setup_claim_id: null }
    const diagnostics = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args)
    let networkFailure
    try {
      networkFailure = await submit({
        mobile: '9876543216',
      }, '192.0.2.6')
    } finally {
      console.error = originalConsoleError
    }
    assert.equal(networkFailure.status, 502)
    assert.equal((await networkFailure.json()).code, 'AUTH_CREATION_UNCONFIRMED')
    assert.deepEqual(calls, [
      '/rest/v1/main_admin_setup_state',
      '/rest/v1/rpc/claim_main_system_administrator_setup',
      '/auth/v1/admin/users',
    ])
    assert.ok(state.setup_claim_id)
    const diagnosticLog = JSON.stringify(diagnostics)
    assert.match(diagnosticLog, /status.*null/)
    assert.match(diagnosticLog, /failureType.*network/)
    assert.match(diagnosticLog, /ECONNRESET/)
    assert.doesNotMatch(diagnosticLog, /network@example\.test|test-only-password|test-setup-key/)

    calls.length = 0
    state = { setup_completed: false, setup_claim_id: null }
    const duplicate = await submit({ mobile: '9876543215' }, '192.0.2.5')
    assert.equal(duplicate.status, 409)
    assert.equal((await duplicate.json()).code, 'AUTH_ACCOUNT_ALREADY_EXISTS')
    assert.equal(state.setup_claim_id, null)
    assert.deepEqual(calls, [
      '/rest/v1/main_admin_setup_state',
      '/rest/v1/rpc/claim_main_system_administrator_setup',
      '/auth/v1/admin/users',
      '/rest/v1/rpc/release_main_system_administrator_setup',
    ])

    calls.length = 0
    state = { setup_completed: false, setup_claim_id: null }
    const bootstrapCountBeforeRace = bootstrapCount
    const [first, second] = await Promise.all([
      submit({ mobile: '9876543217' }, '192.0.2.7'),
      submit({ mobile: '9876543218' }, '192.0.2.8'),
    ])
    assert.deepEqual([first.status, second.status].sort(), [201, 409])
    assert.equal(authUserCount, 2)
    assert.equal(bootstrapCount, bootstrapCountBeforeRace + 1)
    assert.equal(state.setup_completed, true)
    assert.equal(state.initial_admin_user_id, 'auth-user-2')
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
