import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './routing/index.js'
import { startGmailPollScheduler } from './modules/events/sources/gmail/gmail.scheduler.js'
import { startSseNotificationEngine } from './modules/events/sse/sse.handler.js'
import { startRoutingEngine } from './modules/routing/router/router.engine.js'

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
  startRoutingEngine()
  startSseNotificationEngine()
  startGmailPollScheduler()
})
