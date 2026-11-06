import { Router } from 'express'
import { staffAuthConfig, staffAuthEnvironmentStatus } from '../lib/staffAuth.js'

const router = Router()
router.get('/', (_req, res) => res.status(200).json({ status: 'ok', message: 'AplaJansevak API is running.' }))

router.get('/supabase', async (_req, res) => {
  const environment = staffAuthEnvironmentStatus()
  const config = staffAuthConfig()
  if (!config) {
    console.error('Supabase health check configuration failed:', {
      supabaseUrlPresent: environment.supabaseUrlPresent,
      supabaseUrlValid: environment.supabaseUrlValid,
      publishableKeyPresent: environment.publishableKeyPresent,
      secretKeyPresent: environment.secretKeyPresent,
    })
    return res.status(503).json({
      status: 'error',
      service: 'supabase',
      reason: 'configuration_missing',
      message: 'Backend Supabase configuration is incomplete or invalid.',
    })
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/`, {
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
      },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403
        ? 'credentials_rejected'
        : 'supabase_unavailable'
      console.error('Supabase health check failed:', { reason, status: response.status })
      return res.status(503).json({
        status: 'error',
        service: 'supabase',
        reason,
        message: reason === 'credentials_rejected'
          ? 'Supabase rejected the backend API key.'
          : 'Backend could not reach the Supabase REST service.',
      })
    }
    console.info('Supabase health check succeeded:', { status: response.status })
    return res.status(200).json({ status: 'ok', service: 'supabase' })
  } catch {
    console.error('Supabase health check failed:', { reason: 'network_error' })
    return res.status(503).json({
      status: 'error',
      service: 'supabase',
      reason: 'network_error',
      message: 'Backend cannot reach Supabase.',
    })
  }
})

export default router
