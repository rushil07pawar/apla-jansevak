import { Router } from 'express'
import {
  authorizeMainAdministrator,
  createStaffAccount,
  listDepartments,
  listStaffDesignations,
  listStaffDirectory,
  listWards,
  manageStaffDesignation,
  setStaffPassword,
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
router.get('/designations', handleAdmin(async ({ config }) => listStaffDesignations(config)))
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
  res.status(201).json({ staff: result.profile, message: 'Staff account created. Share the password with the staff member through a secure channel.' })
}, { action: 'staff-create', max: 10 }))

router.post('/designations', handleAdmin(async ({ req, res, config, userId }) => {
  const designation = await manageStaffDesignation(config, userId, 'create', req.body)
  res.status(201).json({ designation, message: 'Designation added.' })
}, { action: 'designation-create', max: 30 }))

router.patch('/designations/:designationId', handleAdmin(async ({ req, res, config, userId }) => {
  const designation = await manageStaffDesignation(config, userId, 'update', req.body, req.params.designationId)
  res.json({ designation, message: 'Designation updated.' })
}))

router.patch('/designations/:designationId/active', handleAdmin(async ({ req, res, config, userId }) => {
  const designation = await manageStaffDesignation(config, userId, 'set_active', req.body, req.params.designationId)
  res.json({ designation, message: 'Designation status updated.' })
}))

router.patch('/staff/:userId', handleAdmin(async ({ req, res, config, userId }) => {
  const result = await updateStaffAccount(config, userId, req.params.userId, req.body)
  res.json({ staff: result.profile, message: 'Staff profile saved.' })
}))

router.patch('/staff/:userId/active', handleAdmin(async ({ req, res, config, userId }) => {
  const profile = await setStaffActive(config, userId, req.params.userId, req.body?.active)
  res.json({ staff: profile })
}))

router.put('/staff/:userId/password', handleAdmin(async ({ req, res, config, userId }) => {
  await setStaffPassword(config, userId, req.params.userId, req.body?.password)
  res.json({ message: 'Staff password updated.' })
}, { action: 'staff-password', max: 10 }))

export default router
