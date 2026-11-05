import { Router } from 'express'
import { activeStaff, fixedWindowRateLimit, normalizeIndianMobile, passwordSession, staffAuthConfig } from '../lib/staffAuth.js'

const router = Router()
const genericFailure = { message: 'Unable to sign in with those credentials.' }
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
  if (!mobile || !password || !config) return res.status(401).json(genericFailure)
  try {
    const session = await passwordSession(config, mobile, password)
    const staff = session?.user?.id ? await activeStaff(config, session.user.id, mobile) : null
    if (!session || !staff || staff.force_password_change) return res.status(401).json(genericFailure)
    return res.status(200).json({
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
      },
      staff: {
        role: staff.role,
        department_id: staff.department_id,
        force_password_change: staff.force_password_change,
      },
    })
  } catch {
    return res.status(401).json(genericFailure)
  }
})

export default router
