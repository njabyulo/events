import 'dotenv/config'
import { serve } from '@hono/node-server'
import { closeDatabase } from 'database/runtime'
import { app } from './transport/http/index.js'
import { startGmailPollScheduler } from './runtime/gmail/gmail.scheduler.js'
import {
  sseNotificationEngine,
  startSseNotificationEngine,
} from './transport/sse/sse.transport.js'
import {
  routingEngine,
  startRoutingEngine,
} from './runtime/routing/router.engine.js'
import {
  dashboardConsumerEngine,
  startDashboardConsumerEngine,
} from './runtime/triage/dashboard.consumer.js'
import {
  digestScheduler,
  startDigestScheduler,
} from './runtime/digests/digest.scheduler.js'
import {
  agentConsumerEngine,
  startAgentConsumerEngine,
} from './runtime/agents/agent.consumer.js'
import {
  telegramConsumerEngine,
  startTelegramConsumerEngine,
} from './runtime/telegram/telegram.consumer.js'
import {
  escalationsScheduler,
  startEscalationsScheduler,
} from './runtime/escalations/escalations.scheduler.js'

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
  startAgentConsumerEngine()
  startTelegramConsumerEngine()
  startEscalationsScheduler()
  stopGmailPolling = startGmailPollScheduler()
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}; draining consumers`)
  stopGmailPolling?.()
  digestScheduler.stop()
  escalationsScheduler.stop()
  await Promise.allSettled([
    agentConsumerEngine.stop(),
    telegramConsumerEngine.stop(),
    dashboardConsumerEngine.stop(),
    routingEngine.stop(),
    sseNotificationEngine.stop(),
  ])
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeDatabase()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
