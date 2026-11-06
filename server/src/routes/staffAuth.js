import { Router } from 'express'
import { authorizeStaffLogin, fixedWindowRateLimit, normalizeIndianMobile, passwordSession, staffAuthConfig } from '../lib/staffAuth.js'

const router = Router()
const genericFailure = { message: 'Unable to sign in with those credentials.' }
const invalidMobile = { message: 'Enter a valid Indian mobile number using exactly 10 digits.' }
const ip = req => req.ip || 'unknown'
const loginLimit = fixedWindowRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: req => `login:${ip(req)}:${normalizeIndianMobile(req.body?.mobile) || 'invalid'}`,
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
