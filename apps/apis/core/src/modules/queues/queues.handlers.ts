import type { DigestService } from "core/digests";
import type { QueuesService } from "core/queues";

type QueuesPort = Pick<QueuesService,
  | "listQueues"
  | "getQueue"
  | "createQueue"
  | "updateQueue"
  | "deleteQueue"
  | "sendMessage"
  | "receiveMessages"
  | "ackMessage"
  | "nackMessage"
  | "snoozeMessage"
  | "extendMessageVisibility"
  | "listAttempts"
  | "listDeadLetters"
  | "getStats"
>;
type DigestPort = Pick<DigestService, "flushQueue">;

export class QueuesHandlers {
  constructor(
    private readonly queues: QueuesPort,
    private readonly digests: DigestPort,
  ) {}

  list() { return this.queues.listQueues(); }
  get(id: string) { return this.queues.getQueue(id); }
  create(command: Record<string, unknown>) { return this.queues.createQueue(command); }
  update(id: string, command: Record<string, unknown>) {
    return this.queues.updateQueue(id, command);
  }
  delete(id: string) { return this.queues.deleteQueue(id); }
  send(queueId: string, command: Record<string, unknown>) {
    return this.queues.sendMessage(queueId, command);
  }
  receive(queueId: string, command: Record<string, unknown>) {
    return this.queues.receiveMessages(queueId, command);
  }
  ack(queueId: string, messageId: string, command: Record<string, unknown>) {
    return this.queues.ackMessage(
      queueId,
      messageId,
      command.receiptHandle,
      command.consumerName,
    );
  }
  nack(queueId: string, messageId: string, command: Record<string, unknown>) {
    return this.queues.nackMessage(queueId, messageId, command);
  }
  snooze(queueId: string, messageId: string, command: Record<string, unknown>) {
    return this.queues.snoozeMessage(queueId, messageId, command);
  }
  extendVisibility(queueId: string, messageId: string, command: Record<string, unknown>) {
    return this.queues.extendMessageVisibility(queueId, messageId, command);
  }
  listAttempts(messageId: string) { return this.queues.listAttempts(messageId); }
  listDeadLetters(queueId: string, limit?: string, beforeId?: string) {
    return this.queues.listDeadLetters(queueId, limit, beforeId);
  }
  stats(queueId: string) { return this.queues.getStats(queueId); }
  flushDigest(queueId: string) { return this.digests.flushQueue(queueId); }
}

export const createQueuesHandlers = (
  queues: QueuesPort,
  digests: DigestPort,
): QueuesHandlers => new QueuesHandlers(queues, digests);
