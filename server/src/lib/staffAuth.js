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

export function staffAuthConfig() {
  const url = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && publishableKey && secretKey ? { url: url.replace(/\/$/, ''), publishableKey, secretKey } : null
}

async function supabaseRequest(config, path, options = {}) {
  return fetch(`${config.url}${path}`, options)
}

export async function passwordSession(config, mobile, password) {
  const response = await supabaseRequest(config, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({ phone: mobile, password }),
  })
  if (response.status === 400 || response.status === 401) return null
  if (!response.ok) {
    const error = new Error('The staff authentication service is temporarily unavailable.')
    error.status = 503
    throw error
  }
  return response.json()
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
