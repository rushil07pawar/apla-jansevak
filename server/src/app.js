import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import healthRouter from './routes/health.js'
import staffAuthRouter from './routes/staffAuth.js'
import staffManagementRouter from './routes/staffManagement.js'
import staffWorkRouter from './routes/staffWork.js'
import { staffAuthEnvironmentStatus } from './lib/staffAuth.js'

function configuredFrontendOrigins() {
  const configured = [process.env.FRONTEND_URL, process.env.CLIENT_ORIGIN]
    .filter(Boolean)
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
  const origins = new Set()
  for (const value of configured) {
    try {
      origins.add(new URL(value).origin)
    } catch {
      console.error('Ignoring invalid frontend origin configuration:', { invalid: true })
    }
  }
  if (!origins.size && process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:5173')
  }
  return origins
}

export function createApp() {
  const app = express()
  const port = Number(process.env.PORT) || 5000
  const allowedOrigins = configuredFrontendOrigins()
  const environmentStatus = staffAuthEnvironmentStatus()

  console.info('AplaJansevak backend configuration:', {
    nodeEnvironment: process.env.NODE_ENV || 'unset',
    portConfigured: Boolean(process.env.PORT),
    supabase: {
      urlPresent: environmentStatus.supabaseUrlPresent,
      urlValid: environmentStatus.supabaseUrlValid,
      publishableKeyPresent: environmentStatus.publishableKeyPresent,
      secretKeyPresent: environmentStatus.secretKeyPresent,
    },
    frontendUrlPresent: environmentStatus.frontendUrlPresent,
    adminSetupKeyPresent: environmentStatus.setupKeyPresent,
    supabaseTransport: 'server-side fetch (no Supabase JS client)',
    allowedOriginCount: allowedOrigins.size,
    listeningPort: port,
  })

  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true)
      console.warn('CORS request origin rejected:', { origin })
      return callback(null, false)
    },
  }))
  app.use(express.json())
  app.use('/api/health', healthRouter)
  app.use('/api/staff-auth', staffAuthRouter)
  app.use('/api/admin', staffManagementRouter)
  app.use('/api/staff', staffWorkRouter)
  app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }))
  return app
}
