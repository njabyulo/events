import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './routing/index.js'
import { startGmailPollScheduler } from './modules/events/sources/gmail/gmail.scheduler.js'

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
  startGmailPollScheduler()
})
