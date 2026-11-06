import { Router } from 'express'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  adminSetupKey,
  authorizeStaffLogin,
  fixedWindowRateLimit,
  normalizeIndianMobile,
  passwordSession,
  staffAuthConfig,
  staffAuthEnvironmentStatus,
} from '../lib/staffAuth.js'

const router = Router()
const genericFailure = { message: 'Unable to sign in with those credentials.' }
const invalidMobile = { message: 'Enter a valid Indian mobile number using exactly 10 digits.' }
const ip = req => req.ip || 'unknown'
const staffLoginLimit = fixedWindowRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: req => `staff-login:${ip(req)}:${normalizeIndianMobile(req.body?.mobile) || 'invalid'}`,
})
const adminLoginLimit = fixedWindowRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: req => `admin-login:${ip(req)}`,
})
const adminPromotionLimit = fixedWindowRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  key: req => `admin-promotion:${ip(req)}`,
})

async function mainAdministratorSetupState(config) {
  const query = new URLSearchParams({
    select: 'setup_completed,setup_claim_id',
    singleton: 'eq.true',
    limit: '1',
  })
  let response
  try {
    response = await fetch(`${config.url}/rest/v1/main_admin_setup_state?${query}`, {
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
    const payload = await response.json().catch(() => ({}))
    const code = typeof payload.code === 'string' ? payload.code : ''
    const error = new Error('Supabase setup-status query failed.')
    error.code = response.status === 401 || response.status === 403
      ? 'SUPABASE_AUTH_FAILED'
      : response.status === 404 || ['42P01', 'PGRST205'].includes(code)
        ? 'DATABASE_MIGRATION_REQUIRED'
        : 'SUPABASE_QUERY_FAILED'
    error.status = response.status
    throw error
  }
  const rows = await response.json()
  if (!Array.isArray(rows) || rows.length !== 1 ||
      typeof rows[0].setup_completed !== 'boolean') {
    const error = new Error('Supabase returned an invalid setup-status response.')
    error.code = 'DATABASE_MIGRATION_REQUIRED'
    throw error
  }
  return {
    completed: rows[0].setup_completed,
    inProgress: typeof rows[0].setup_claim_id === 'string',
  }
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

async function authenticatedUser(config, req) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null

  let response
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    const error = new Error('Supabase authentication could not be verified.')
    error.status = 503
    throw error
  }
  if (!response.ok) return null
  const user = await response.json().catch(() => null)
  return typeof user?.id === 'string' ? user : null
}

async function mainAdministratorProfile(config, userId) {
  const query = new URLSearchParams({
    select: 'user_id,role,is_main_system_admin,department_id,active,approved,force_password_change,full_name_en,designation_en',
    user_id: `eq.${userId}`,
    limit: '1',
  })
  const response = await fetch(`${config.url}/rest/v1/staff_profiles?${query}`, {
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) {
    const error = new Error('Unable to verify Main System Administrator access.')
    error.status = 503
    throw error
  }
  const profiles = await response.json()
  return Array.isArray(profiles) ? profiles[0] || null : null
}

async function releaseAdministratorSetupClaim(config, claimId) {
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/release_main_system_administrator_setup`, {
      method: 'POST',
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_claim_id: claimId }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      console.error('Administrator promotion claim release failed:', {
        stage: 'releasing_setup_claim',
        status: response.status,
      })
      return false
    }
    return true
  } catch {
    console.error('Administrator promotion claim release failed:', {
      stage: 'releasing_setup_claim',
      status: null,
    })
    return false
  }
}

router.get('/admin-setup/status', async (_req, res) => {
  const envStatus = staffAuthEnvironmentStatus()
  const config = staffAuthConfig()
  if (!config) {
    console.error('Admin promotion status configuration check failed:', {
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
    const setup = await mainAdministratorSetupState(config)
    if (setup.completed) return res.json({ available: false, reason: 'closed' })
    if (setup.inProgress) return res.json({ available: false, reason: 'in_progress' })
    if (!setupKeyIsConfigured()) {
      return res.status(503).json({
        available: false,
        reason: 'ADMIN_SETUP_KEY_MISSING',
        message: 'Initial administrator promotion is disabled by the backend.',
      })
    }
    return res.json({ available: true })
  } catch (error) {
    console.error('Admin promotion status query failed:', {
      reason: error.code || 'SUPABASE_QUERY_FAILED',
      status: error.status || null,
    })
    return res.status(503).json({
      available: false,
      reason: error.code || 'SUPABASE_QUERY_FAILED',
      message: 'Backend could not verify administrator setup. Check migrations and backend logs.',
    })
  }
})

router.post('/admin-promote', adminPromotionLimit, async (req, res) => {
  const config = staffAuthConfig()
  if (!config || !setupKeyIsConfigured()) {
    return res.status(503).json({ message: 'Initial administrator promotion is not available.' })
  }
  if (!setupKeyMatches(req.body?.setupKey)) {
    return res.status(403).json({ message: 'The setup key is invalid or initial setup is closed.' })
  }

  try {
    const user = await authenticatedUser(config, req)
    if (!user || !user.email || !user.email_confirmed_at) {
      return res.status(401).json({ message: 'Sign in with the confirmed citizen email account you intend to promote.' })
    }

    const setup = await mainAdministratorSetupState(config)
    if (setup.completed || setup.inProgress) {
      return res.status(409).json({ message: 'Initial administrator promotion is closed or already in progress.' })
    }

    const claimId = randomUUID()
    const claimResponse = await fetch(`${config.url}/rest/v1/rpc/claim_main_system_administrator_setup`, {
      method: 'POST',
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_claim_id: claimId }),
      signal: AbortSignal.timeout(10000),
    })
    if (!claimResponse.ok) {
      return res.status(claimResponse.status === 409 ? 409 : 503).json({
        message: 'Initial administrator promotion is closed or another request is in progress.',
      })
    }

    let response
    try {
      response = await fetch(`${config.url}/rest/v1/rpc/promote_citizen_to_main_system_administrator`, {
        method: 'POST',
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_user_id: user.id, p_claim_id: claimId }),
        signal: AbortSignal.timeout(10000),
      })
    } catch (error) {
      console.error('Main System Administrator promotion outcome is unconfirmed:', {
        stage: 'promoting_citizen_profile',
        exceptionName: error?.name || 'Error',
        reason: 'DATABASE_CONNECTION_FAILED',
        status: null,
        claimPreserved: true,
      })
      return res.status(503).json({
        message: 'Promotion outcome could not be confirmed. The existing account was not changed or deleted; ask the operator to verify setup before retrying.',
      })
    }
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}))
      const errorCode = typeof errorPayload.code === 'string' ? errorPayload.code : ''
      if (response.status < 500) await releaseAdministratorSetupClaim(config, claimId)
      const conflict = response.status === 409 || ['23505', '23514'].includes(errorCode)
      const ineligible = errorCode === '22023'
      console.warn('Main System Administrator promotion was rejected:', {
        stage: 'promoting_citizen_profile',
        status: response.status,
        reason: conflict ? 'PROMOTION_CONFLICT' : 'PROMOTION_REJECTED',
        databaseCode: /^[A-Z0-9]{5}$/i.test(errorCode) ? errorCode : null,
      })
      return res.status(conflict ? 409 : ineligible ? 403 : response.status < 500 ? 400 : 503).json({
        message: conflict
          ? 'Another Main System Administrator already exists or this account is not eligible for promotion.'
          : ineligible
            ? 'Only an existing, confirmed Citizen account can be promoted.'
          : 'The existing account could not be promoted. Verify the migration and citizen profile before retrying.',
      })
    }
    const profile = await response.json().catch(() => null)
    if (profile?.user_id !== user.id ||
        profile.role !== 'administrator' ||
        profile.is_main_system_admin !== true ||
        profile.department_id !== null) {
      console.error('Main System Administrator promotion returned an unexpected profile result.')
      return res.status(503).json({
        message: 'Promotion outcome could not be confirmed. The existing account was preserved; ask the operator to verify it before retrying.',
      })
    }
    return res.status(200).json({
      message: 'Your existing account is now the Main System Administrator. Sign in at Administrator Login.',
    })
  } catch (error) {
    console.error('Main System Administrator promotion failed:', {
      reason: error.code || 'PROMOTION_VERIFICATION_FAILED',
      status: error.status || null,
    })
    return res.status(error.status === 503 ? 503 : 500).json({
      message: error.status === 503
        ? 'The backend could not verify your account or contact Supabase. Retry after the service is available.'
        : 'Unable to verify the existing account for promotion.',
    })
  }
})

router.post('/admin-login', adminLoginLimit, async (req, res) => {
  const config = staffAuthConfig()
  if (!config) return res.status(503).json({ message: 'Administrator login is not configured.' })
  try {
    const user = await authenticatedUser(config, req)
    if (!user) return res.status(401).json(genericFailure)
    const profile = await mainAdministratorProfile(config, user.id)
    if (!user.email || !user.email_confirmed_at ||
        !profile ||
        profile.role !== 'administrator' ||
        profile.is_main_system_admin !== true ||
        profile.department_id !== null ||
        !profile.active ||
        !profile.approved ||
        profile.force_password_change) {
      return res.status(401).json(genericFailure)
    }
    return res.json({
      staff: {
        user_id: profile.user_id,
        role: profile.role,
        is_main_system_admin: profile.is_main_system_admin,
        department_id: null,
      },
    })
  } catch (error) {
    console.error('Main System Administrator login verification failed:', {
      reason: error.status === 503 ? 'AUTH_OR_DATABASE_UNAVAILABLE' : 'ADMIN_AUTHORIZATION_FAILED',
      status: error.status || null,
    })
    return res.status(error.status === 503 ? 503 : 500).json({
      message: error.status === 503
        ? 'The administrator authorization service is temporarily unavailable.'
        : 'Unable to verify administrator access.',
    })
  }
})

async function loginStaff(req, res) {
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
    if (!access.authorized) {
      return res.status(access.status).json({ message: access.message })
    }
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
    if (error.diagnostic) {
      console.error('Staff password authentication failed:', {
        reason: error.code,
        ...error.diagnostic,
      })
    }
    if (error.status === 429) return res.status(429).json({ message: error.message })
    if (error.status === 503) return res.status(503).json({ message: error.message })
    if (error instanceof TypeError) {
      console.error('Staff authorization verification failed:', {
        stage: 'verifying_staff_profile_and_permissions',
        reason: 'STAFF_AUTHORIZATION_NETWORK_FAILURE',
        failureType: 'network',
        exceptionName: error.name,
        status: null,
      })
      return res.status(503).json({ message: 'Could not reach Supabase to verify staff login. Check the server connection and try again.' })
    }
    console.error('Staff login authorization failed:', {
      exceptionName: error.name || 'Error',
      status: Number.isInteger(error.status) ? error.status : null,
    })
    return res.status(500).json({ message: 'Unable to verify staff access right now. Please try again later.' })
  }
}

router.post('/login', staffLoginLimit, loginStaff)

export default router
