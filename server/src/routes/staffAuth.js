import { Router } from 'express'
import { activeStaff, completePhoneRecovery, fixedWindowRateLimit, normalizeIndianMobile, passwordSession, staffAuthConfig, startPhoneRecovery } from '../lib/staffAuth.js'

const router = Router()
const genericFailure = { message: 'Unable to sign in with those credentials.' }
const genericRecovery = { message: 'If the account is eligible, recovery instructions will be sent.' }
const ip = req => req.ip || 'unknown'
const loginLimit = fixedWindowRateLimit({ windowMs: 15 * 60 * 1000, max: 5, key: req => `login:${ip(req)}:${normalizeIndianMobile(req.body?.mobile) || 'invalid'}` })
const recoveryLimit = fixedWindowRateLimit({ windowMs: 60 * 60 * 1000, max: 3, key: req => `recovery:${ip(req)}:${normalizeIndianMobile(req.body?.mobile) || 'invalid'}` })

router.post('/login', loginLimit, async (req, res) => {
  const mobile = normalizeIndianMobile(req.body?.mobile)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const config = staffAuthConfig()
  if (!mobile || !password || !config) return res.status(401).json(genericFailure)
  try {
    const session = await passwordSession(config, mobile, password)
    const staff = session?.user?.id ? await activeStaff(config, session.user.id, mobile) : null
    if (!session || !staff) return res.status(401).json(genericFailure)
    return res.status(200).json({ session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in, token_type: session.token_type }, staff: { role: staff.role, department_id: staff.department_id, force_password_change: staff.force_password_change } })
  } catch { return res.status(401).json(genericFailure) }
})

router.post('/recovery/start', recoveryLimit, async (req, res) => {
  const mobile = normalizeIndianMobile(req.body?.mobile)
  const config = staffAuthConfig()
  if (mobile && config) { try { await startPhoneRecovery(config, mobile) } catch {} }
  return res.status(202).json(genericRecovery)
})

router.post('/recovery/complete', recoveryLimit, async (req, res) => {
  const mobile = normalizeIndianMobile(req.body?.mobile)
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const config = staffAuthConfig()
  if (!mobile || !/^\d{6}$/.test(token) || password.length < 12 || !config) return res.status(400).json({ message: 'Unable to reset the password.' })
  try { return await completePhoneRecovery(config, mobile, token, password) ? res.status(200).json({ message: 'Password updated. You can now sign in.' }) : res.status(400).json({ message: 'Unable to reset the password.' }) } catch { return res.status(400).json({ message: 'Unable to reset the password.' }) }
})

export default router
