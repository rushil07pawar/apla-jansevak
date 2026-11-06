import { Router } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { adminSetupKey, authorizeStaffLogin, fixedWindowRateLimit, normalizeIndianMobile, passwordSession, staffAuthConfig, staffAuthEnvironmentStatus } from '../lib/staffAuth.js'

const router = Router()
const genericFailure = { message: 'Unable to sign in with those credentials.' }
const invalidMobile = { message: 'Enter a valid Indian mobile number using exactly 10 digits.' }
const ip = req => req.ip || 'unknown'
const loginLimit = fixedWindowRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: req => `login:${ip(req)}:${normalizeIndianMobile(req.body?.mobile) || 'invalid'}`,
})
const adminSetupLimit = fixedWindowRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  key: req => `admin-setup:${ip(req)}`,
})

async function mainAdministratorExists(config) {
  const query = new URLSearchParams({
    select: 'user_id',
    is_main_system_admin: 'eq.true',
    limit: '1',
  })
  let response
  try {
    response = await fetch(`${config.url}/rest/v1/staff_profiles?${query}`, {
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
      },
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    const error = new Error('Supabase could not be reached.')
    error.code = 'SUPABASE_UNAVAILABLE'
    throw error
  }
  if (!response.ok) {
    const error = new Error('Supabase setup-status query failed.')
    error.code = response.status === 401 || response.status === 403
      ? 'SUPABASE_AUTH_FAILED'
      : 'SUPABASE_QUERY_FAILED'
    error.status = response.status
    throw error
  }
  const profiles = await response.json()
  if (!Array.isArray(profiles)) {
    const error = new Error('Supabase returned an invalid setup-status response.')
    error.code = 'SUPABASE_QUERY_FAILED'
    throw error
  }
  return Array.isArray(profiles) && profiles.length > 0
}

function setupKeyIsConfigured() {
  const key = adminSetupKey()
  return typeof key === 'string' && Buffer.byteLength(key, 'utf8') >= 32
}

function setupKeyMatches(candidate) {
  const expected = adminSetupKey()
  if (!setupKeyIsConfigured() || typeof candidate !== 'string') return false
  const expectedBytes = Buffer.from(expected, 'utf8')
  const candidateBytes = Buffer.from(candidate, 'utf8')
  return expectedBytes.length === candidateBytes.length &&
    timingSafeEqual(expectedBytes, candidateBytes)
}

async function removeNewAuthUser(config, userId) {
  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
    },
  })
  return response.ok
}

router.get('/admin-setup/status', async (_req, res) => {
  const envStatus = staffAuthEnvironmentStatus()
  const config = staffAuthConfig()
  if (!config) {
    console.error('Admin setup status configuration check failed:', {
      stage: 'configuration',
      supabaseUrlPresent: envStatus.supabaseUrlPresent,
      supabaseUrlValid: envStatus.supabaseUrlValid,
      publishableKeyPresent: envStatus.publishableKeyPresent,
      secretKeyPresent: envStatus.secretKeyPresent,
    })
    return res.status(503).json({
      available: false,
      reason: 'BACKEND_CONFIGURATION_MISSING',
      message: 'Backend Supabase configuration is incomplete or invalid.',
    })
  }
  try {
    if (await mainAdministratorExists(config)) {
      console.info('Admin setup status query completed:', { result: 'closed' })
      return res.status(200).json({ available: false, reason: 'closed' })
    }
    if (!setupKeyIsConfigured()) {
      console.info('Admin setup status query completed:', {
        result: 'disabled',
        reason: 'setup_key_missing',
      })
      return res.status(503).json({
        available: false,
        reason: 'ADMIN_SETUP_KEY_MISSING',
        message: 'Initial administrator setup is disabled by the backend.',
      })
    }
    console.info('Admin setup status query completed:', { result: 'open' })
    return res.status(200).json({ available: true })
  } catch (error) {
    console.error('Admin setup status query failed:', {
      result: 'error',
      reason: error.code || 'SUPABASE_QUERY_FAILED',
      status: error.status || null,
    })
    return res.status(503).json({
      available: false,
      reason: error.code || 'SUPABASE_QUERY_FAILED',
      message: error.code === 'SUPABASE_UNAVAILABLE'
        ? 'Backend cannot reach Supabase. Check backend-to-Supabase network access.'
        : error.code === 'SUPABASE_AUTH_FAILED'
          ? 'Backend Supabase credentials were rejected. Check the server-only API key.'
          : 'Backend could not verify administrator setup in Supabase. Check migrations and backend logs.',
    })
  }
})

router.post('/admin-setup', adminSetupLimit, async (req, res) => {
  const config = staffAuthConfig()
  if (!config || !setupKeyIsConfigured()) {
    return res.status(503).json({ message: 'Initial administrator setup is not available.' })
  }

  const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {}
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : ''
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : ''
  const mobile = normalizeIndianMobile(input.mobile)
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const confirmation = typeof input.confirmPassword === 'string' ? input.confirmPassword : ''

  if (fullName.length < 2 || fullName.length > 100 ||
      !/^[a-z0-9_]{3,30}$/.test(username) ||
      !mobile ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 12 || password.length > 128 ||
      password !== confirmation ||
      typeof input.setupKey !== 'string' || input.setupKey.length === 0) {
    return res.status(400).json({ message: 'Check the name, username, mobile, email, password, and setup key fields.' })
  }
  if (!setupKeyMatches(input.setupKey)) {
    return res.status(403).json({ message: 'The setup key is invalid or initial setup is closed.' })
  }

  let authUserId = null
  let stage = 'checking_setup'
  try {
    if (await mainAdministratorExists(config)) {
      return res.status(409).json({ message: 'Initial administrator setup is closed.' })
    }

    stage = 'creating_auth_user'
    const createResponse = await fetch(`${config.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        email_confirm: true,
        phone: mobile,
        phone_confirm: true,
        password,
        app_metadata: { account_type: 'staff' },
        user_metadata: { full_name: fullName, username },
      }),
    })
    if (createResponse.status === 409 || createResponse.status === 422) {
      return res.status(409).json({ message: 'That email or mobile number is already registered. Use the existing staff login; accounts are not promoted or duplicated.' })
    }
    if (!createResponse.ok) throw new Error('Auth user creation failed.')
    const authUser = await createResponse.json()
    if (typeof authUser?.id !== 'string') throw new Error('Auth did not return a user ID.')
    authUserId = authUser.id

    stage = 'creating_staff_profile'
    const profileResponse = await fetch(`${config.url}/rest/v1/rpc/bootstrap_main_system_administrator`, {
      method: 'POST',
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: authUserId, p_full_name: fullName }),
    })
    if (!profileResponse.ok) {
      const error = new Error('The database rejected the administrator bootstrap.')
      error.bootstrapStatus = profileResponse.status
      throw error
    }
    const profile = await profileResponse.json()
    if (profile?.user_id !== authUserId ||
        profile.department_id !== null ||
        profile.role !== 'administrator' ||
        profile.is_main_system_admin !== true) {
      stage = 'verifying_staff_profile'
      throw new Error('The bootstrap returned an unexpected profile.')
    }

    return res.status(201).json({
      message: 'Main System Administrator created. Sign in through Municipal Staff Login.',
      loginPath: '/staff-login',
    })
  } catch (error) {
    let cleanupFailed = false
    if (authUserId && stage !== 'verifying_staff_profile') {
      try {
        cleanupFailed = !(await removeNewAuthUser(config, authUserId))
      } catch {
        cleanupFailed = true
      }
    }
    console.error('Initial administrator setup failed:', {
      stage,
      status: error.bootstrapStatus || null,
      cleanupFailed,
    })
    if (cleanupFailed) {
      return res.status(503).json({ message: 'Setup could not be completed, and cleanup needs operator review. Contact the deployment operator before retrying.' })
    }
    if (stage === 'creating_staff_profile' && await mainAdministratorExists(config).catch(() => false)) {
      return res.status(409).json({ message: 'Initial administrator setup is closed.' })
    }
    return res.status(503).json({ message: 'Unable to complete initial administrator setup. Check server configuration and database migrations, then contact the operator.' })
  }
})

router.post('/login', loginLimit, async (req, res) => {
  const mobile = normalizeIndianMobile(req.body?.mobile)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const config = staffAuthConfig()
  if (!mobile) return res.status(400).json(invalidMobile)
  if (!password) return res.status(400).json({ message: 'Enter your password.' })
  if (!config) return res.status(503).json({ message: 'Staff login is not configured. Contact the system administrator.' })
  try {
    const session = await passwordSession(config, mobile, password)
    if (!session) return res.status(401).json(genericFailure)
    const access = await authorizeStaffLogin(config, session.user.id, mobile)
    if (!access.authorized) return res.status(access.status).json({ message: access.message })
    const { staff } = access
    return res.status(200).json({
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
      },
      staff: {
        user_id: staff.user_id,
        role: staff.role,
        department_id: staff.department_id,
        department: staff.department,
        staff_id: staff.staff_id,
        full_name_mr: staff.full_name_mr,
        full_name_en: staff.full_name_en,
        designation_mr: staff.designation_mr,
        designation_en: staff.designation_en,
        is_main_system_admin: staff.isMainAdministrator,
        wards: staff.wards,
        permissions: staff.permissions,
        reports_to: staff.reportsTo,
      },
    })
  } catch (error) {
    if (error.status === 503) {
      return res.status(503).json({ message: error.message })
    }
    if (error instanceof TypeError) {
      return res.status(503).json({ message: 'Could not reach Supabase to verify staff login. Check the server connection and try again.' })
    }
    console.error('Staff login authorization failed:', error.message)
    return res.status(500).json({ message: 'Unable to verify staff access right now. Please try again later.' })
  }
})

export default router
