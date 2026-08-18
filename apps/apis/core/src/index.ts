import 'dotenv/config'
import { serve } from '@hono/node-server'
import { closeDatabase } from 'database/runtime'
import { app } from './transport/http/index.js'
import { runtimeConfig } from './runtime/runtime.config.js'
import {
  gmailPollScheduler,
  startGmailPollScheduler,
} from './runtime/gmail/gmail.scheduler.js'
import {
  sseNotificationEngine,
  startSseNotificationEngine,
} from './transport/sse/sse.transport.js'
import {
  routingEngine,
  startRoutingEngine,
} from './runtime/routing/router.engine.js'
import {
  replayEngine,
  startReplayEngine,
} from './runtime/routing/replay.engine.js'
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
import {
  maintenanceScheduler,
  startMaintenanceScheduler,
} from './runtime/maintenance/maintenance.scheduler.js'

const server = serve({
  fetch: app.fetch,
  port: runtimeConfig.port
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
  startRoutingEngine()
  startReplayEngine()
  startSseNotificationEngine()
  startDashboardConsumerEngine()
  startDigestScheduler()
  startAgentConsumerEngine()
  startTelegramConsumerEngine()
  startEscalationsScheduler()
  startMaintenanceScheduler()
  startGmailPollScheduler()
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}; draining consumers`)
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()))
  await Promise.allSettled([
    gmailPollScheduler.stop(),
    digestScheduler.stop(),
    escalationsScheduler.stop(),
    maintenanceScheduler.stop(),
    agentConsumerEngine.stop(),
    telegramConsumerEngine.stop(),
    dashboardConsumerEngine.stop(),
    replayEngine.stop(),
    routingEngine.stop(),
    sseNotificationEngine.stop(),
  ])
  await serverClosed
  await closeDatabase()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
