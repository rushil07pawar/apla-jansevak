const INDIAN_MOBILE = /^[6-9][0-9]{9}$/

export function normalizeIndianMobile(value) {
  if (typeof value !== 'string') return null
  let digits = value.trim().replace(/[\s().-]/g, '')
  if (digits.startsWith('+91')) digits = digits.slice(3)
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2)
  if (!INDIAN_MOBILE.test(digits)) return null
  return `+91${digits}`
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
    method: 'POST', headers: { apikey: config.publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ phone: mobile, password })
  })
  return response.ok ? response.json() : null
}

export async function activeStaff(config, userId, mobile) {
  const query = new URLSearchParams({ select: 'user_id,department_id,role,active,approved,force_password_change,mobile_e164', user_id: `eq.${userId}`, mobile_e164: `eq.${mobile}`, limit: '1' })
  const response = await supabaseRequest(config, `/rest/v1/staff_profiles?${query}`, {
    headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` }
  })
  if (!response.ok) return null
  const [staff] = await response.json()
  return staff?.active && staff?.approved ? staff : null
}

export async function startPhoneRecovery(config, mobile) {
  const response = await supabaseRequest(config, '/auth/v1/otp', {
    method: 'POST', headers: { apikey: config.publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ phone: mobile, create_user: false })
  })
  if (!response.ok) throw new Error('Supabase could not send a password setup code to this mobile number.')
}

export async function completePhoneRecovery(config, mobile, token, password) {
  const verified = await supabaseRequest(config, '/auth/v1/verify', {
    method: 'POST', headers: { apikey: config.publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ phone: mobile, token, type: 'sms' })
  })
  if (!verified.ok) return false
  const session = await verified.json()
  const staff = session?.user?.id ? await activeStaff(config, session.user.id, mobile) : null
  if (!staff) return false
  const changed = await supabaseRequest(config, '/auth/v1/user', {
    method: 'PUT', headers: { apikey: config.publishableKey, authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ password })
  })
  if (!changed.ok) return false
  const query = new URLSearchParams({ user_id: `eq.${session.user.id}`, mobile_e164: `eq.${mobile}` })
  const cleared = await supabaseRequest(config, `/rest/v1/staff_profiles?${query}`, {
    method: 'PATCH', headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify({ force_password_change: false })
  })
  return cleared.ok
}
