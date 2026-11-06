import assert from 'node:assert/strict'
import { test } from 'node:test'
import { passwordSession } from '../src/lib/staffAuth.js'

const config = {
  url: 'https://project-ref.supabase.co',
  publishableKey: 'sb_publishable_test_key',
  secretKey: 'sb_secret_test_key',
}
const mobile = '+919876543210'
const password = 'test-only-password'

test('uses Supabase phone/password grant with the publishable apikey', async () => {
  let captured
  const expectedSession = { access_token: 'test-token', user: { id: 'auth-user-test' } }
  const session = await passwordSession(config, mobile, password, {
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return Response.json(expectedSession)
    },
  })

  assert.equal(captured.url, 'https://project-ref.supabase.co/auth/v1/token?grant_type=password')
  assert.equal(captured.options.method, 'POST')
  assert.equal(captured.options.headers.apikey, config.publishableKey)
  assert.equal(captured.options.headers['content-type'], 'application/json')
  assert.equal(captured.options.headers.authorization, undefined)
  assert.deepEqual(JSON.parse(captured.options.body), { phone: mobile, password })
  assert.deepEqual(session, expectedSession)
})

test('treats 400 and invalid-credential 401 responses as invalid credentials', async () => {
  for (const [status, payload] of [
    [400, { code: 'invalid_credentials', msg: 'Invalid login credentials' }],
    [401, { error: 'invalid_grant', error_description: 'Invalid credentials' }],
  ]) {
    const session = await passwordSession(config, mobile, password, {
      fetchImpl: async () => Response.json(payload, { status }),
    })
    assert.equal(session, null)
  }
})

test('reports rate limiting and config rejection with safe upstream diagnostics', async () => {
  for (const [status, payload, expectedCode] of [
    [429, { code: 'over_request_rate_limit', msg: 'Too many requests' }, 'SUPABASE_AUTH_RATE_LIMITED'],
    [401, { code: 'invalid_api_key', msg: `Rejected ${config.publishableKey} for ${mobile}` }, 'SUPABASE_AUTH_CONFIGURATION'],
    [403, { code: 'not_allowed', msg: 'Project access denied' }, 'SUPABASE_AUTH_CONFIGURATION'],
    [502, { code: 'gateway_error', msg: 'Upstream unavailable' }, 'SUPABASE_AUTH_UPSTREAM_FAILURE'],
  ]) {
    await assert.rejects(
      passwordSession(config, mobile, password, {
        fetchImpl: async () => Response.json(payload, { status }),
      }),
      error => {
        assert.equal(error.code, expectedCode)
        assert.equal(error.diagnostic.status, status)
        assert.equal(error.diagnostic.httpResponseReceived, true)
        assert.equal(error.diagnostic.host, 'project-ref.supabase.co')
        assert.equal(error.diagnostic.path, '/auth/v1/token')
        assert.doesNotMatch(JSON.stringify(error.diagnostic), /sb_publishable_test_key|sb_secret_test_key|9876543210|test-only-password/)
        return true
      },
    )
  }
})

test('reports unexpected Supabase responses without returning raw provider details', async () => {
  await assert.rejects(
    passwordSession(config, mobile, password, {
      fetchImpl: async () => Response.json(
        { code: 'unexpected_error', message: `Failed for ${mobile} using ${password}` },
        { status: 418 },
      ),
    }),
    error => {
      assert.equal(error.code, 'SUPABASE_AUTH_UNEXPECTED_RESPONSE')
      assert.equal(error.status, 503)
      assert.equal(error.diagnostic.status, 418)
      assert.doesNotMatch(error.message, /9876543210|test-only-password/)
      return true
    },
  )

  await assert.rejects(
    passwordSession(config, mobile, password, {
      fetchImpl: async () => Response.json({ user: { id: 'auth-user-test' } }, { status: 200 }),
    }),
    error => {
      assert.equal(error.code, 'SUPABASE_AUTH_UNEXPECTED_RESPONSE')
      assert.equal(error.diagnostic.status, 200)
      return true
    },
  )
})

test('reports network errors with sanitized cause information and no HTTP status', async () => {
  const cause = Object.assign(new Error(`connection failed for ${mobile}`), { code: 'ECONNRESET' })
  await assert.rejects(
    passwordSession(config, mobile, password, {
      fetchImpl: async () => {
        throw new TypeError(`request failed with ${password}`, { cause })
      },
    }),
    error => {
      assert.equal(error.code, 'SUPABASE_AUTH_NETWORK_FAILURE')
      assert.equal(error.status, 503)
      assert.equal(error.diagnostic.failureType, 'network')
      assert.equal(error.diagnostic.status, null)
      assert.equal(error.diagnostic.httpResponseReceived, false)
      assert.equal(error.diagnostic.causeCode, 'ECONNRESET')
      assert.doesNotMatch(JSON.stringify(error.diagnostic), /9876543210|test-only-password|sb_publishable_test_key/)
      return true
    },
  )
})
