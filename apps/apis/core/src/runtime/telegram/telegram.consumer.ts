import { createConsumerWorker, type ConsumerWorker } from "core/consumers";
import { createTelegramService } from "core/telegram";
import { QueueConsumerEngine, databaseListener } from "../consumers/queue-consumer.engine.js";
import { queuesService } from "../../modules/queues/queues.module.js";
import { telegramClient } from "../../integrations/telegram/telegram.client.js";
import { telegramConfig } from "../../integrations/telegram/telegram.config.js";

const telegramService = createTelegramService(telegramClient);

async function createWorker(): Promise<ConsumerWorker> {
  const queue = await queuesService.getQueueByName(telegramConfig.queueName);
  const consumerName = `${telegramConfig.consumerName}:${queue.name}`;
  return createConsumerWorker({
    consumerName,
    maxConcurrency: 1,
    maxDeferred: 1,
    pollIntervalMs: telegramConfig.pollIntervalMs,
    visibilityTimeoutSeconds: telegramConfig.visibilityTimeoutSeconds,
    heartbeatIntervalMs: Math.max(1_000, telegramConfig.visibilityTimeoutSeconds * 500),
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
    handle: async (message) => {
      await telegramService.deliver(message.event);
      return "ack";
    },
    onError: (error, message) => console.error("Telegram delivery failed", {
      messageId: message?.id,
      error,
    }),
  });
}

export const telegramConsumerEngine = new QueueConsumerEngine({
  name: "Telegram consumer",
  createListener: databaseListener,
  createWorker,
  queueChannel: process.env.QUEUE_CHANNEL?.trim() || "queue_ready",
  reconnectDelayMs: telegramConfig.reconnectDelayMs,
  shutdownDeadlineMs: telegramConfig.shutdownDeadlineMs,
});

export function startTelegramConsumerEngine(): void {
  if (telegramConfig.enabled) telegramConsumerEngine.start();
}
