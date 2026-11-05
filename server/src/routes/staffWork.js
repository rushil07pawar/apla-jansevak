import { Router } from 'express'
import {
  authorizeStaffSession,
  getStaffDashboard,
  manageComplaint,
} from '../lib/staffManagement.js'

const router = Router()

function handleStaff(handler) {
  return async (req, res) => {
    try {
      const context = await authorizeStaffSession(req)
      res.json(await handler({ req, context }))
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500
      if (status >= 500) console.error('Staff work request failed:', error.message)
      res.status(status).json({
        message: status >= 500 ? 'Unable to load or update authorized complaint data.' : error.message,
      })
    }
  }
}

router.get('/dashboard', handleStaff(async ({ context }) => {
  return getStaffDashboard(context.config, context.userId, context.staff)
}))

router.post('/complaints/:complaintId/actions', handleStaff(async ({ req, context }) => {
  return manageComplaint(context.config, context.userId, req.params.complaintId, req.body)
}))

export default router
