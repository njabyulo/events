import 'dotenv/config'
import { serve } from '@hono/node-server'
import { closeDatabase } from 'database/runtime'
import { app } from './routing/index.js'
import { startGmailPollScheduler } from './modules/events/sources/gmail/gmail.scheduler.js'
import {
  sseNotificationEngine,
  startSseNotificationEngine,
} from './modules/events/sse/sse.handler.js'
import {
  routingEngine,
  startRoutingEngine,
} from './modules/routing/router/router.engine.js'
import {
  dashboardConsumerEngine,
  startDashboardConsumerEngine,
} from './modules/triage/dashboard.consumer.js'
import {
  digestScheduler,
  startDigestScheduler,
} from './modules/digests/digest.scheduler.js'

let stopGmailPolling: (() => void) | undefined

const server = serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
  startRoutingEngine()
  startSseNotificationEngine()
  startDashboardConsumerEngine()
  startDigestScheduler()
  stopGmailPolling = startGmailPollScheduler()
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}; draining consumers`)
  stopGmailPolling?.()
  digestScheduler.stop()
  await Promise.allSettled([
    dashboardConsumerEngine.stop(),
    routingEngine.stop(),
    sseNotificationEngine.stop(),
  ])
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeDatabase()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
