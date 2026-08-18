import type { IngestEventResult } from "database/events";
import type { ReceivedQueueMessage } from "database/queues";
import type { ThreadRecord, ThreadSummaryRecord } from "database/triage";
import type { EventEnvelope } from "../events/events.service.js";
import { AgentNotFoundError } from "./agent.errors.js";
import { AgentUtils } from "./agent.utils.js";
import type { AgentConsumeResult, TriageAgentClient } from "./agent.types.js";

export type AgentEventPublisher = {
  ingestEvent(envelope: EventEnvelope): Promise<IngestEventResult>;
};

export type AgentThreadStore = {
  listThreads(streamKey: string, limit?: number): Promise<ThreadSummaryRecord[]>;
  getThread(id: string, historyLimit?: number): Promise<ThreadRecord | null>;
};

export type AgentServiceConfig = {
  confidenceThreshold: number;
  modelId: string;
  maxCandidateThreads: number;
  maxHistoryEvents: number;
  maxHistoryCharacters: number;
};

export class AgentService {
  constructor(
    private readonly agent: TriageAgentClient,
    private readonly publisher: AgentEventPublisher,
    private readonly threads: AgentThreadStore,
    private readonly config: AgentServiceConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async consume(
    message: ReceivedQueueMessage,
    streamKey: string,
  ): Promise<AgentConsumeResult> {
    const event = message.event;
    if (typeof event.attributes.classifiedBy === "string") {
      return { status: "loop_skipped" };
    }
    if (event.type === "thread.reply") return this.respond(event);

    const candidates = AgentUtils.threadCandidates(
      await this.threads.listThreads(streamKey, this.config.maxCandidateThreads),
      this.config.maxCandidateThreads,
    );
    const classification = await this.agent.classify({
      event: AgentUtils.eventInput(event),
      candidateThreads: candidates,
    });
    if (classification.confidence < this.config.confidenceThreshold) {
      return AgentUtils.humanDecision(event, classification);
    }
    const result = await this.publisher.ingestEvent(AgentUtils.classificationEnvelope(
      event,
      classification,
      candidates,
      this.config.modelId,
      this.clock(),
    ));
    return { status: "published", eventId: result.id, duplicate: !result.inserted };
  }

  async publishUserReply(
    threadId: string,
    actorValue: unknown,
    messageValue: unknown,
  ): Promise<IngestEventResult> {
    const thread = await this.threads.getThread(threadId, 1);
    if (!thread) throw new AgentNotFoundError();
    return this.publisher.ingestEvent(AgentUtils.userReplyEnvelope(
      thread,
      AgentUtils.requiredActor(actorValue),
      AgentUtils.requiredReply(messageValue),
      this.clock(),
    ));
  }

  private async respond(event: ReceivedQueueMessage["event"]): Promise<AgentConsumeResult> {
    const threadId = event.links.find(({ kind }) => kind === "thread_id")?.value;
    const thread = threadId
      ? await this.threads.getThread(threadId, this.config.maxHistoryEvents)
      : null;
    if (!thread) throw new AgentNotFoundError("Thread reply references an unavailable thread");
    const reply = await this.agent.reply({
      thread: AgentUtils.threadCandidates([thread], 1)[0]!,
      history: AgentUtils.replyHistory(
        thread.messages,
        this.config.maxHistoryEvents,
        this.config.maxHistoryCharacters,
      ),
      actor: event.actor,
      message: event.summary || "",
    });
    const result = await this.publisher.ingestEvent(AgentUtils.replyEnvelope(
      event,
      thread,
      reply,
      this.config.modelId,
      this.clock(),
    ));
    return { status: "published", eventId: result.id, duplicate: !result.inserted };
  }
}

export const createAgentService = (
  dependencies: {
    agent: TriageAgentClient;
    publisher: AgentEventPublisher;
    threads: AgentThreadStore;
    config: AgentServiceConfig;
    clock?: () => Date;
  },
): AgentService => new AgentService(
  dependencies.agent,
  dependencies.publisher,
  dependencies.threads,
  dependencies.config,
  dependencies.clock,
);
