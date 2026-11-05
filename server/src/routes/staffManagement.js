import { Router } from 'express'
import {
  authorizeMainAdministrator,
  createStaffAccount,
  listDepartments,
  listStaffDirectory,
  listWards,
  recordPasswordResetRequest,
  requestStaffCredentialReset,
  setStaffActive,
  updateStaffAccount,
} from '../lib/staffManagement.js'

const router = Router()
const rateLimits = new Map()

function consumeRateLimit(key, max) {
  const now = Date.now()
  const current = rateLimits.get(key)
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 60 * 60 * 1000 }
    : current
  entry.count += 1
  rateLimits.set(key, entry)
  return entry.count <= max
}

function handleAdmin(handler, limit) {
  return async (req, res) => {
    try {
      const { config, userId } = await authorizeMainAdministrator(req)
      if (limit && !consumeRateLimit(`${limit.action}:${userId}:${req.params.userId || ''}`, limit.max)) {
        return res.status(429).json({ message: 'Too many staff-management attempts. Please try again later.' })
      }
      const result = await handler({ req, res, config, userId })
      if (result !== undefined && !res.headersSent) res.json(result)
    } catch (error) {
      if (res.headersSent) return
      const status = Number.isInteger(error.status) ? error.status : 500
      if (status >= 500) console.error('Staff management request failed:', {
        message: error.message,
        cleanupError: error.cleanupError,
        rollbackError: error.rollbackError,
      })
      res.status(status).json({
        message: status >= 500 ? 'Unable to complete the staff-management request.' : error.message,
        ...(error.cleanupError ? { cleanupWarning: 'The new Auth account could not be removed after setup failed; check the Auth user list.' } : {}),
        ...(error.rollbackError ? { rollbackWarning: 'The Auth phone change could not be reverted; check the Auth user and staff profile before further changes.' } : {}),
      })
    }
  }
}

router.get('/departments', handleAdmin(async ({ config }) => listDepartments(config)))
router.get('/wards', handleAdmin(async ({ config }) => listWards(config)))
router.get('/staff', handleAdmin(async ({ config }) => listStaffDirectory(config)))

router.get('/audit-logs', handleAdmin(async ({ config }) => {
  const query = new URLSearchParams({
    select: 'id,actor_user_id,action,target_type,target_id,details,created_at',
    order: 'created_at.desc',
    limit: '200',
  })
  const response = await fetch(`${config.url}/rest/v1/admin_audit_logs?${query}`, {
    headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` },
  })
  const rows = await response.json().catch(() => null)
  if (!response.ok) throw new Error('Unable to load administrative audit logs.')
  return rows
}))

router.post('/staff', handleAdmin(async ({ req, res, config, userId }) => {
  const result = await createStaffAccount(config, userId, req.body)
  res.status(201).json({
    staff: result.profile,
    recoverySent: result.recoverySent,
    message: result.recoverySent
      ? 'Staff account created. A password setup code was sent to the registered mobile number.'
      : result.recoveryMessage || 'Staff account created, but a password setup code could not be sent. Use Reset password to retry.',
  })
}, { action: 'staff-create', max: 10 }))

router.patch('/staff/:userId', handleAdmin(async ({ req, res, config, userId }) => {
  const result = await updateStaffAccount(config, userId, req.params.userId, req.body)
  res.json({
    staff: result.profile,
    recoverySent: result.recoverySent,
    message: result.recoverySent === false
      ? result.recoveryMessage || 'Staff profile saved, but its new mobile number did not receive a password setup code.'
      : 'Staff profile saved.',
  })
}))

router.patch('/staff/:userId/active', handleAdmin(async ({ req, res, config, userId }) => {
  const profile = await setStaffActive(config, userId, req.params.userId, req.body?.active)
  res.json({ staff: profile })
}))

router.post('/staff/:userId/password-reset', handleAdmin(async ({ req, res, config, userId }) => {
  await requestStaffCredentialReset(config, req.params.userId)
  await recordPasswordResetRequest(config, userId, req.params.userId)
  res.status(202).json({ message: 'A password setup code was sent to the registered mobile number.' })
}, { action: 'staff-reset', max: 3 }))

export default router
