import { randomUUID } from "node:crypto";
import { createConsumerWorker, type ConsumerWorker } from "core/consumers";
import type { ReceivedQueueMessage } from "core/queues";
import { QueueConsumerEngine, databaseListener } from "../consumers/queue-consumer.engine.js";
import { queuesService } from "../../modules/queues/queues.module.js";
import { triageConfig } from "../../modules/triage/triage.config.js";
import { triageService } from "../../modules/triage/triage.module.js";
import { agentService } from "../../modules/agents/agent.module.js";
import { agentRuntimeConfig } from "./agent.config.js";
import { Env } from "../../config/env.js";

async function createWorker(): Promise<ConsumerWorker> {
  const queue = await queuesService.getQueueByName(agentRuntimeConfig.queueName);
  const instanceId = randomUUID();
  const consumerName = `${agentRuntimeConfig.consumerName}:${queue.name}`;
  return createConsumerWorker({
    consumerName,
    maxConcurrency: agentRuntimeConfig.maxConcurrency,
    maxDeferred: 500,
    pollIntervalMs: agentRuntimeConfig.pollIntervalMs,
    visibilityTimeoutSeconds: agentRuntimeConfig.visibilityTimeoutSeconds,
    heartbeatIntervalMs: agentRuntimeConfig.heartbeatIntervalMs,
    queueClient: {
      receive: (options) => queuesService.receiveMessages(queue.id, options),
      ack: async (message) => {
        await queuesService.ackMessage(queue.id, message.id, message.receiptHandle, consumerName);
        return true;
      },
      nack: async (message, error) => {
        await queuesService.nackMessage(queue.id, message.id, {
          receiptHandle: message.receiptHandle,
          consumerName,
          receiveCount: message.receiveCount,
          error,
        });
        return true;
      },
      release: (message) => queuesService.releaseMessage(
        queue.id,
        message.id,
        message.receiptHandle ?? "",
        consumerName,
      ),
      extendVisibility: (message, seconds) => queuesService.extendVisibility(
        queue.id,
        message.id,
        message.receiptHandle ?? "",
        consumerName,
        seconds,
      ),
    },
    handle: async (message: ReceivedQueueMessage) => {
      const result = await agentService.consume(message, triageConfig.streamKey);
      if (result.status !== "human") return "ack";
      await triageService.deliver(message, {
        consumerName,
        consumerInstanceId: instanceId,
        streamKey: triageConfig.streamKey,
        decision: result.decision,
        threadKey: result.threadKey,
      });
      return "defer";
    },
    onError: (error, message) => console.error("Agent consumer attempt failed", {
      messageId: message?.id,
      error,
    }),
  });
}

export const agentConsumerEngine = new QueueConsumerEngine({
  name: "Agent consumer",
  createListener: databaseListener,
  createWorker,
  queueChannel: Env.channel("QUEUE_CHANNEL", "queue_ready"),
  reconnectDelayMs: agentRuntimeConfig.reconnectDelayMs,
  shutdownDeadlineMs: agentRuntimeConfig.shutdownDeadlineMs,
});

export function startAgentConsumerEngine(): void {
  if (agentRuntimeConfig.enabled) agentConsumerEngine.start();
}
