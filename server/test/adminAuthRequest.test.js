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
  email: 'admin@example.test',
  email_confirm: true,
  phone: '+919876543210',
  phone_confirm: true,
  password: 'test-only-password',
  app_metadata: { account_type: 'staff' },
  user_metadata: { full_name: 'Test Administrator', username: 'test_admin' },
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

test('calls the bootstrap RPC only after Supabase Auth creates a user', async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    ADMIN_SETUP_KEY: process.env.ADMIN_SETUP_KEY,
    NODE_ENV: process.env.NODE_ENV,
  }
  const calls = []
  process.env.SUPABASE_URL = config.url
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  process.env.SUPABASE_SECRET_KEY = config.secretKey
  process.env.ADMIN_SETUP_KEY = 'test-setup-key-with-at-least-32-characters'
  process.env.NODE_ENV = 'test'
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname
    calls.push(path)
    if (path === '/rest/v1/staff_profiles') return Response.json([])
    if (path === '/auth/v1/admin/users') {
      const request = JSON.parse(options.body)
      if (request.email === 'rejected@example.test') {
        return Response.json({ code: 'invalid_api_key', message: 'Invalid API key' }, { status: 401 })
      }
      if (request.email === 'forbidden@example.test') {
        return Response.json({ code: 'not_allowed', message: 'Administrator operation is not allowed' }, { status: 403 })
      }
      if (request.email === 'invalid@example.test') {
        return Response.json({ code: 'weak_password', message: 'Password does not meet requirements' }, { status: 422 })
      }
      if (request.email === 'network@example.test') {
        const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
        throw new TypeError('fetch failed', { cause })
      }
      if (request.email === 'duplicate@example.test') {
        return Response.json({ code: 'user_already_exists', message: 'User already registered' }, { status: 400 })
      }
      return Response.json({ id: 'auth-user-test' }, { status: 201 })
    }
    if (path === '/rest/v1/rpc/bootstrap_main_system_administrator') {
      return Response.json({
        user_id: 'auth-user-test',
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
        username: 'test_admin',
        mobile: '9876543210',
        email: 'admin@example.test',
        password: 'test-only-password',
        confirmPassword: 'test-only-password',
        setupKey: process.env.ADMIN_SETUP_KEY,
          ...overrides,
        }),
      })
    }
    const response = await submit({}, '192.0.2.1')

    assert.equal(response.status, 201)
    assert.deepEqual(calls, [
      '/rest/v1/staff_profiles',
      '/auth/v1/admin/users',
      '/rest/v1/rpc/bootstrap_main_system_administrator',
    ])

    calls.length = 0
    const rejected = await submit({
      email: 'rejected@example.test',
      mobile: '9876543211',
    }, '192.0.2.2')
    assert.equal(rejected.status, 502)
    assert.equal((await rejected.json()).code, 'AUTH_SERVER_KEY_REJECTED')
    assert.deepEqual(calls, ['/rest/v1/staff_profiles', '/auth/v1/admin/users'])

    calls.length = 0
    const forbidden = await submit({
      email: 'forbidden@example.test',
      mobile: '9876543213',
    }, '192.0.2.3')
    assert.equal(forbidden.status, 502)
    assert.equal((await forbidden.json()).code, 'AUTH_SERVER_KEY_REJECTED')
    assert.deepEqual(calls, ['/rest/v1/staff_profiles', '/auth/v1/admin/users'])

    calls.length = 0
    const invalid = await submit({
      email: 'invalid@example.test',
      mobile: '9876543214',
    }, '192.0.2.4')
    assert.equal(invalid.status, 502)
    assert.equal((await invalid.json()).code, 'AUTH_REQUEST_REJECTED')
    assert.deepEqual(calls, ['/rest/v1/staff_profiles', '/auth/v1/admin/users'])

    calls.length = 0
    const diagnostics = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args)
    let networkFailure
    try {
      networkFailure = await submit({
        email: 'network@example.test',
        mobile: '9876543216',
      }, '192.0.2.6')
    } finally {
      console.error = originalConsoleError
    }
    assert.equal(networkFailure.status, 502)
    assert.equal((await networkFailure.json()).code, 'AUTH_CREATION_UNCONFIRMED')
    assert.deepEqual(calls, ['/rest/v1/staff_profiles', '/auth/v1/admin/users'])
    const diagnosticLog = JSON.stringify(diagnostics)
    assert.match(diagnosticLog, /status.*null/)
    assert.match(diagnosticLog, /failureType.*network/)
    assert.match(diagnosticLog, /ECONNRESET/)
    assert.doesNotMatch(diagnosticLog, /network@example\.test|test-only-password|test-setup-key/)

    calls.length = 0
    const duplicate = await submit({
      email: 'duplicate@example.test',
      mobile: '9876543215',
    }, '192.0.2.5')
    assert.equal(duplicate.status, 409)
    assert.equal((await duplicate.json()).code, 'AUTH_ACCOUNT_ALREADY_EXISTS')
    assert.deepEqual(calls, ['/rest/v1/staff_profiles', '/auth/v1/admin/users'])
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
