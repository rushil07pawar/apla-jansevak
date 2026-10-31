import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import healthRouter from './routes/health.js'
const app = express()
const port = Number(process.env.PORT) || 5000
app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())
app.use('/api/health', healthRouter)
app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }))
app.listen(port, () => console.log(`AplaJansevak API listening on port ${port}`))
