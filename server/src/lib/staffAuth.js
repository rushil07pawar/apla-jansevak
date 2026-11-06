const INDIAN_MOBILE = /^[6-9][0-9]{9}$/

export function normalizeIndianMobile(value) {
  if (typeof value !== 'string' || !INDIAN_MOBILE.test(value)) return null
  return `+91${value}`
}

export function fixedWindowRateLimit({ windowMs, max, key }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const id = key(req)
    const current = hits.get(id)
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current
    entry.count += 1
    hits.set(id, entry)
    if (entry.count > max) return res.status(429).json({ message: 'Too many attempts. Please try again later.' })
    next()
  }
}

function validSupabaseUrl(value) {
  if (typeof value !== 'string' || !value.trim() || /your-project-ref|example\.com/i.test(value)) {
    return false
  }
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) &&
      (url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) &&
      !url.username && !url.password
  } catch {
    return false
  }
}

export function staffAuthEnvironmentStatus() {
  const secretKeyVariable = process.env.SUPABASE_SECRET_KEY
    ? 'SUPABASE_SECRET_KEY'
    : process.env.SUPABASE_SERVICE_ROLE_KEY
      ? 'SUPABASE_SERVICE_ROLE_KEY'
      : null
  return {
    supabaseUrlPresent: Boolean(process.env.SUPABASE_URL),
    supabaseUrlValid: validSupabaseUrl(process.env.SUPABASE_URL),
    publishableKeyPresent: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY),
    secretKeyPresent: Boolean(secretKeyVariable),
    secretKeyVariable,
    setupKeyPresent: Boolean(process.env.ADMIN_SETUP_KEY || process.env.MAIN_ADMIN_SETUP_KEY),
    frontendUrlPresent: Boolean(process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN),
  }
}

export function adminSetupKey() {
  return process.env.ADMIN_SETUP_KEY || process.env.MAIN_ADMIN_SETUP_KEY || ''
}

export function staffAuthConfig() {
  const url = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  return validSupabaseUrl(url) && publishableKey && secretKey
    ? { url: url.replace(/\/$/, ''), publishableKey, secretKey }
    : null
}

async function supabaseRequest(config, path, options = {}) {
  return fetch(`${config.url}${path}`, options)
}

function sanitizedAuthMessage(value, config, mobile, password) {
  const mobileDigits = typeof mobile === 'string' ? mobile : ''
  const passwordValue = typeof password === 'string' ? password : ''
  let message = typeof value === 'string' ? value : ''
  for (const sensitiveValue of [
    config?.publishableKey,
    config?.secretKey,
    mobileDigits,
    mobileDigits.replace(/^\+91/, ''),
    passwordValue,
  ]) {
    if (typeof sensitiveValue === 'string' && sensitiveValue.length > 0) {
      message = message.replaceAll(sensitiveValue, '[redacted]')
    }
  }
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\+?91[\s().-]*[6-9](?:[\s().-]*\d){9}\b/g, '[redacted-mobile]')
    .replace(/\b[6-9]\d{9}\b/g, '[redacted-mobile]')
    .replace(/\beyJ[A-Za-z0-9._-]+/g, '[redacted-token]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240)
}

function authFailure(status, code, message, diagnostic = {}) {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.diagnostic = diagnostic
  return error
}

export async function passwordSession(config, mobile, password, { fetchImpl = fetch } = {}) {
  let response
  try {
    response = await fetchImpl(`${config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ phone: mobile, password }),
      signal: AbortSignal.timeout(10000),
    })
  } catch (error) {
    const cause = error?.cause
    const causeCode = cause?.code || error?.code || null
    const name = error?.name || 'Error'
    const failureType = name === 'TimeoutError' || name === 'AbortError' ||
      ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(causeCode)
      ? 'timeout'
      : ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(causeCode)
        ? 'dns'
        : /certificate|tls|ssl/i.test(`${error?.message || ''} ${cause?.message || ''}`)
          ? 'tls'
          : 'network'
    throw authFailure(
      503,
      'SUPABASE_AUTH_NETWORK_FAILURE',
      'Could not reach Supabase Auth. Try again later.',
      {
        failureType,
        exceptionName: name,
        exceptionMessage: sanitizedAuthMessage(error?.message, config, mobile, password),
        causeName: cause?.name || null,
        causeCode: causeCode && /^[A-Z0-9_]+$/i.test(causeCode) ? causeCode : null,
        requestInitiated: true,
        httpResponseReceived: false,
        status: null,
        host: new URL(config.url).hostname,
        path: '/auth/v1/token',
      },
    )
  }

  const payload = await response.json().catch(() => ({}))
  const rawCode = typeof payload.error_code === 'string'
    ? payload.error_code
    : typeof payload.code === 'string'
      ? payload.code
      : typeof payload.error === 'string'
        ? payload.error
        : ''
  const safeCode = sanitizedAuthMessage(rawCode, config, mobile, password)
  const errorCode = /^[a-z0-9_.-]{1,100}$/i.test(safeCode) ? safeCode : null
  const rawMessage = [payload.msg, payload.message, payload.error_description]
    .find(value => typeof value === 'string')
  const errorMessage = sanitizedAuthMessage(rawMessage, config, mobile, password)
  const diagnostic = {
    failureType: 'http',
    requestInitiated: true,
    httpResponseReceived: true,
    status: response.status,
    host: new URL(config.url).hostname,
    path: '/auth/v1/token',
    supabaseErrorCode: errorCode,
    supabaseErrorMessage: errorMessage || null,
  }

  if (response.ok) {
    if (typeof payload?.access_token !== 'string' || typeof payload?.user?.id !== 'string') {
      throw authFailure(
        503,
        'SUPABASE_AUTH_UNEXPECTED_RESPONSE',
        'Supabase Auth returned an unexpected response. Try again later.',
        diagnostic,
      )
    }
    return payload
  }
  if (response.status === 400 || response.status === 401) {
    if (['invalid_api_key', 'no_api_key', 'unauthorized', 'invalid_key'].includes(errorCode?.toLowerCase())) {
      throw authFailure(503, 'SUPABASE_AUTH_CONFIGURATION', 'Supabase Auth rejected its configured API key.', diagnostic)
    }
    console.warn('Supabase password authentication rejected:', diagnostic)
    return null
  }
  if (response.status === 403) {
    throw authFailure(503, 'SUPABASE_AUTH_CONFIGURATION', 'Supabase Auth rejected its configured API key or project access.', diagnostic)
  }
  if (response.status === 429) {
    throw authFailure(429, 'SUPABASE_AUTH_RATE_LIMITED', 'Too many sign-in attempts. Please wait before trying again.', diagnostic)
  }
  if (response.status >= 500) {
    throw authFailure(503, 'SUPABASE_AUTH_UPSTREAM_FAILURE', 'Supabase Auth is temporarily unavailable. Try again later.', diagnostic)
  }
  throw authFailure(503, 'SUPABASE_AUTH_UNEXPECTED_RESPONSE', 'Supabase Auth returned an unexpected response. Try again later.', diagnostic)
}

export async function activeStaff(config, userId, mobile) {
  const query = new URLSearchParams({
    select: 'user_id,department_id,role,active,approved,force_password_change,is_main_system_admin,mobile_e164,staff_id,full_name_mr,full_name_en,designation_mr,designation_en,department:departments(id,code,name,name_mr)',
    user_id: `eq.${userId}`,
    mobile_e164: `eq.${mobile}`,
    limit: '1',
  })
  const response = await supabaseRequest(config, `/rest/v1/staff_profiles?${query}`, {
    headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` },
  })
  if (!response.ok) {
    const error = new Error('Unable to verify municipal staff authorization.')
    error.status = 503
    throw error
  }
  const [staff] = await response.json()
  return staff || null
}

async function getStaffAccess(config, userId, staff) {
  const [assignmentsResponse, permissionsResponse, hierarchyResponse] = await Promise.all([
    supabaseRequest(config, `/rest/v1/staff_ward_assignments?${new URLSearchParams({
      select: 'ward_id,ward:wards(id,ward_number,ward_name,is_active)',
      staff_user_id: `eq.${userId}`,
    })}`, { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } }),
    supabaseRequest(config, `/rest/v1/staff_permissions?${new URLSearchParams({
      select: 'permission_code,department_id,ward_id',
      staff_user_id: `eq.${userId}`,
    })}`, { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } }),
    supabaseRequest(config, `/rest/v1/staff_hierarchy?${new URLSearchParams({
      select: 'reports_to_user_id',
      staff_user_id: `eq.${userId}`,
      limit: '1',
    })}`, { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } }),
  ])
  if (!assignmentsResponse.ok || !permissionsResponse.ok || !hierarchyResponse.ok) {
    const error = new Error('Unable to load municipal staff department and ward permissions.')
    error.status = 503
    throw error
  }
  const [wardAssignments, permissions, hierarchy] = await Promise.all([
    assignmentsResponse.json(),
    permissionsResponse.json(),
    hierarchyResponse.json(),
  ])
  const activeWards = wardAssignments
    .filter(assignment => assignment.ward?.is_active)
    .map(assignment => assignment.ward)
  const permittedWardIds = new Set(
    permissions
      .filter(permission =>
        permission.department_id === staff.department_id &&
        permission.permission_code === 'complaints.read',
      )
      .map(permission => permission.ward_id),
  )
  const authorizedWards = activeWards.filter(ward => permittedWardIds.has(ward.id))
  const isMainAdministrator = staff.is_main_system_admin === true &&
    staff.role === 'administrator'
  let reportsTo = null
  const reportsToId = hierarchy[0]?.reports_to_user_id
  if (reportsToId) {
    const managerQuery = new URLSearchParams({
      select: 'user_id,staff_id,full_name_mr,full_name_en,designation_mr,designation_en',
      user_id: `eq.${reportsToId}`,
      limit: '1',
    })
    const managerResponse = await supabaseRequest(config, `/rest/v1/staff_profiles?${managerQuery}`, {
      headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` },
    })
    if (!managerResponse.ok) {
      const error = new Error('Unable to verify the configured reporting officer.')
      error.status = 503
      throw error
    }
    const managers = await managerResponse.json()
    reportsTo = managers[0] || null
  }
  return {
    wards: authorizedWards,
    permissions: permissions.filter(permission =>
      permission.department_id === staff.department_id &&
      activeWards.some(ward => ward.id === permission.ward_id),
    ),
    reportsTo,
    isMainAdministrator,
  }
}

export async function authorizeStaffLogin(config, userId, mobile) {
  const staff = await activeStaff(config, userId, mobile)
  if (!staff) {
    return { authorized: false, status: 403, message: 'This account is not registered as municipal staff.' }
  }
  if (!staff.active || !staff.approved) {
    return { authorized: false, status: 403, message: 'This municipal staff account is inactive or awaiting administrator approval.' }
  }
  if (staff.force_password_change) {
    return { authorized: false, status: 403, message: 'Contact the Main System Administrator to set or reset your password.' }
  }
  const access = await getStaffAccess(config, staff.user_id, staff)
  if (!access.isMainAdministrator && !access.wards.length) {
    return { authorized: false, status: 403, message: 'No active ward and complaint permissions are assigned to this account. Contact the Main System Administrator.' }
  }
  return { authorized: true, staff: { ...staff, ...access } }
}
