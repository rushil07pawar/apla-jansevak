import 'dotenv/config'
import { createApp } from './app.js'

const app = createApp()
const port = Number(process.env.PORT) || 5000
app.listen(port, () => console.log(`AplaJansevak API listening on port ${port}`))
