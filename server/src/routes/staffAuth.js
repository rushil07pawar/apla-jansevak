import { Router } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { adminSetupKey, authorizeStaffLogin, fixedWindowRateLimit, normalizeIndianMobile, passwordSession, staffAuthConfig, staffAuthEnvironmentStatus } from '../lib/staffAuth.js'
import { requestAuthAdminUser, safeAuthResponseDetails } from '../lib/adminAuthRequest.js'

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

async function findStaffProfile(config, userId) {
  const query = new URLSearchParams({
    select: 'user_id,role,is_main_system_admin,department_id',
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
  if (!response.ok) return null
  const profiles = await response.json()
  return Array.isArray(profiles) ? profiles[0] || null : null
}

async function setupFailureCode(response, { authService = false, payload = null } = {}) {
  payload ||= await response.json().catch(() => ({}))
  const code = typeof payload.code === 'string' ? payload.code : ''
  const message = [payload.message, payload.msg, payload.error, payload.error_description]
    .filter(value => typeof value === 'string')
    .join(' ')
  if (authService && (response.status === 401 || response.status === 403)) {
    return 'AUTH_SERVER_KEY_REJECTED'
  }
  if (response.status === 401 || response.status === 403 || code === '42501') {
    return 'DATABASE_PERMISSION_DENIED'
  }
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204'].includes(code)) {
    return 'DATABASE_MIGRATION_REQUIRED'
  }
  if (['23503', '23505', '23514'].includes(code)) {
    return 'DATABASE_PROFILE_CONFLICT'
  }
  if (/already registered|already exists|duplicate/i.test(message)) {
    return 'AUTH_ACCOUNT_ALREADY_EXISTS'
  }
  if (response.status === 400 || response.status === 409 || response.status === 422) {
    return 'AUTH_REQUEST_REJECTED'
  }
  return 'SUPABASE_SERVICE_ERROR'
}

function setupFailureMessage(code) {
  switch (code) {
    case 'AUTH_ACCOUNT_ALREADY_EXISTS':
      return 'An Auth account already uses one of these identifiers. It was not changed or promoted. Ask the operator to verify the existing account before continuing.'
    case 'AUTH_REQUEST_REJECTED':
      return 'Supabase Auth rejected the submitted account details. Check Auth configuration and whether the email or mobile is already registered.'
    case 'AUTH_SERVICE_UNAVAILABLE':
      return 'The backend could not complete the Supabase Auth request. Check backend-to-Supabase connectivity and server logs.'
    case 'AUTH_SERVER_KEY_REJECTED':
      return 'Supabase Auth rejected the backend server key. Verify the server-only Supabase key in the backend environment.'
    case 'AUTH_CREATION_UNCONFIRMED':
      return 'Supabase did not confirm whether the Auth account was created. Verify the existing account before attempting setup again.'
    case 'DATABASE_MIGRATION_REQUIRED':
      return 'The administrator database function or required schema is missing. Verify migrations 003–006 before retrying.'
    case 'DATABASE_PERMISSION_DENIED':
      return 'The database denied the administrator profile operation. Verify the service key and RPC grants; do not disable RLS.'
    case 'DATABASE_PROFILE_CONFLICT':
      return 'A profile or uniqueness constraint prevented setup. The existing Auth account was preserved; inspect its linked profiles before retrying.'
    case 'DATABASE_CONNECTION_FAILED':
      return 'Supabase could not be reached while creating the administrator profile. The Auth account was preserved; verify its profile before retrying.'
    case 'AUTH_USER_CREATED_PROFILE_FAILED':
      return 'The Auth account was created, but its administrator profile was not confirmed. The account was preserved; have the operator inspect it before retrying.'
    default:
      return 'Initial administrator setup failed. The account was not deleted; ask the operator to inspect safe stage/status diagnostics before retrying.'
  }
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
  let failureCode = null
  let failureStatus = null
  let authRequestDiagnostic = null
  let authResponseDetails = null
  try {
    if (await mainAdministratorExists(config)) {
      return res.status(409).json({ message: 'Initial administrator setup is closed.' })
    }

    stage = 'creating_auth_user'
    let createResponse
    try {
      const request = await requestAuthAdminUser(config, {
        email,
        email_confirm: true,
        phone: mobile,
        phone_confirm: true,
        password,
        app_metadata: { account_type: 'staff' },
        user_metadata: { full_name: fullName, username },
      })
      createResponse = request.response
      failureStatus = createResponse.status
      authRequestDiagnostic = {
        requestInitiated: true,
        httpResponseReceived: true,
        status: createResponse.status,
        host: request.host,
        path: request.path,
      }
    } catch (requestError) {
      authRequestDiagnostic = requestError?.diagnostic || null
      failureCode = requestError?.code === 'AUTH_REQUEST_CONSTRUCTION_FAILED'
        ? 'AUTH_REQUEST_CONSTRUCTION_FAILED'
        : authRequestDiagnostic?.requestInitiated &&
            !['dns', 'tls'].includes(authRequestDiagnostic.failureType)
          ? 'AUTH_CREATION_UNCONFIRMED'
          : 'AUTH_SERVICE_UNAVAILABLE'
      throw new Error('Supabase Auth is unreachable.')
    }
    if (!createResponse.ok) {
      const authErrorPayload = await createResponse.json().catch(() => ({}))
      authResponseDetails = safeAuthResponseDetails(authErrorPayload, [
        config.secretKey,
        password,
        email,
        mobile,
        fullName,
        username,
        input.setupKey,
      ])
      failureCode = await setupFailureCode(createResponse, { authService: true, payload: authErrorPayload })
      if (createResponse.status >= 500) failureCode = 'AUTH_CREATION_UNCONFIRMED'
      if (failureCode === 'AUTH_ACCOUNT_ALREADY_EXISTS') {
        console.warn('Supabase Auth administrator creation rejected:', {
          stage,
          reason: failureCode,
          status: createResponse.status,
          requestInitiated: true,
          httpResponseReceived: true,
          host: authRequestDiagnostic.host,
          path: authRequestDiagnostic.path,
          supabaseErrorCode: authResponseDetails.code,
          supabaseErrorMessage: authResponseDetails.message,
        })
        return res.status(409).json({ code: failureCode, message: setupFailureMessage(failureCode) })
      }
      throw new Error('Supabase Auth rejected user creation.')
    }
    const authUser = await createResponse.json()
    if (typeof authUser?.id !== 'string') {
      failureCode = 'AUTH_CREATION_UNCONFIRMED'
      throw new Error('Auth did not confirm whether it created the user.')
    }
    authUserId = authUser.id

    stage = 'creating_staff_profile'
    let profileResponse
    try {
      profileResponse = await fetch(`${config.url}/rest/v1/rpc/bootstrap_main_system_administrator`, {
        method: 'POST',
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_user_id: authUserId, p_full_name: fullName }),
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      failureCode = 'DATABASE_CONNECTION_FAILED'
      throw new Error('Supabase database is unreachable.')
    }
    if (!profileResponse.ok) {
      failureStatus = profileResponse.status
      failureCode = await setupFailureCode(profileResponse)
      throw new Error('The database rejected the administrator bootstrap.')
    }
    const profile = await profileResponse.json()
    if (profile?.user_id !== authUserId ||
        profile.department_id !== null ||
        profile.role !== 'administrator' ||
        profile.is_main_system_admin !== true) {
      failureCode = 'AUTH_USER_CREATED_PROFILE_FAILED'
      throw new Error('The bootstrap returned an unexpected profile.')
    }

    return res.status(201).json({
      message: 'Main System Administrator created. Sign in through Municipal Staff Login.',
      loginPath: '/staff-login',
    })
  } catch (error) {
    if (authUserId) {
      const profile = await findStaffProfile(config, authUserId).catch(() => null)
      if (profile?.role === 'administrator' &&
          profile.is_main_system_admin === true &&
          profile.department_id === null) {
        console.info('Initial administrator profile verified after an interrupted bootstrap response.')
        return res.status(201).json({
          message: 'Main System Administrator created. Sign in through Municipal Staff Login.',
          loginPath: '/staff-login',
        })
      }
      if (profile) failureCode = 'DATABASE_PROFILE_CONFLICT'
      else if (!failureCode) failureCode = 'AUTH_USER_CREATED_PROFILE_FAILED'
    } else if (!failureCode) {
      failureCode = stage === 'creating_auth_user'
        ? 'AUTH_SERVICE_UNAVAILABLE'
        : 'SUPABASE_SERVICE_ERROR'
    }

    const authCreationState = authUserId
      ? 'created'
      : failureCode === 'AUTH_ACCOUNT_ALREADY_EXISTS'
        ? 'existing_account'
        : failureCode === 'AUTH_CREATION_UNCONFIRMED'
          ? 'unconfirmed'
          : 'not_created'
    console.error('Initial administrator setup failed:', {
      stage,
      reason: failureCode,
      status: stage === 'creating_auth_user'
        ? authRequestDiagnostic?.status ?? failureStatus
        : failureStatus,
      authUserCreated: authCreationState === 'created'
        ? true
        : authCreationState === 'not_created'
          ? false
          : null,
      accountPreserved: authUserId ? true : authCreationState === 'not_created' ? false : null,
      authCreationState,
      ...(stage === 'creating_auth_user' ? {
        exceptionName: authRequestDiagnostic?.exceptionName || null,
        exceptionMessage: authRequestDiagnostic?.exceptionMessage || null,
        causeName: authRequestDiagnostic?.causeName || null,
        causeCode: authRequestDiagnostic?.causeCode || null,
        requestInitiated: authRequestDiagnostic?.requestInitiated ?? false,
        httpResponseReceived: authRequestDiagnostic?.httpResponseReceived ?? false,
        failureType: authRequestDiagnostic?.failureType || (failureStatus ? 'http' : 'response_processing'),
        host: authRequestDiagnostic?.host || null,
        path: authRequestDiagnostic?.path || '/auth/v1/admin/users',
        supabaseErrorCode: authResponseDetails?.code || null,
        supabaseErrorMessage: authResponseDetails?.message || null,
      } : {}),
    })
    if (authUserId) {
      return res.status(failureCode === 'DATABASE_PROFILE_CONFLICT' ? 409 : 503).json({
        code: failureCode,
        authUserCreated: true,
        message: setupFailureMessage(failureCode),
      })
    }
    return res.status(failureCode === 'AUTH_ACCOUNT_ALREADY_EXISTS' ? 409 : 502).json({
      code: failureCode,
      message: setupFailureMessage(failureCode),
    })
  }
})

async function loginStaff(req, res, { administratorOnly = false } = {}) {
  const mobile = normalizeIndianMobile(req.body?.mobile)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const config = staffAuthConfig()
  if (!mobile) return res.status(400).json(administratorOnly ? genericFailure : invalidMobile)
  if (!password) return res.status(400).json({ message: 'Enter your password.' })
  if (!config) return res.status(503).json({ message: 'Staff login is not configured. Contact the system administrator.' })
  try {
    const session = await passwordSession(config, mobile, password)
    if (!session) return res.status(401).json(genericFailure)
    const access = await authorizeStaffLogin(config, session.user.id, mobile)
    if (!access.authorized) {
      return administratorOnly
        ? res.status(access.status === 503 ? 503 : 401).json(genericFailure)
        : res.status(access.status).json({ message: access.message })
    }
    const { staff } = access
    if (administratorOnly &&
        (staff.role !== 'administrator' ||
         staff.is_main_system_admin !== true ||
         staff.isMainAdministrator !== true)) {
      return res.status(401).json(genericFailure)
    }
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
    if (error.status === 429) {
      return res.status(429).json({ message: error.message })
    }
    if (error.status === 503) {
      return res.status(503).json({ message: error.message })
    }
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

router.post('/login', loginLimit, (req, res) => loginStaff(req, res))
router.post('/admin-login', loginLimit, (req, res) => loginStaff(req, res, { administratorOnly: true }))

export default router
