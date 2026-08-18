import type { AgentService } from "core/agents";
import type { StreamsService, ThreadsService, TriageService } from "core/triage";

type TriagePort = Pick<TriageService, "listItems">;
type ThreadsPort = Pick<ThreadsService, "listThreads" | "getThread" | "ack" | "snooze">;
type StreamsPort = Pick<StreamsService, "getHighWaterMark" | "listMessages">;
type AgentRepliesPort = Pick<AgentService, "publishUserReply">;

export class TriageHandlers {
  constructor(
    private readonly triage: TriagePort,
    private readonly defaultStreamKey: string,
  ) {}

  listItems(streamKey?: string) {
    return this.triage.listItems(streamKey || this.defaultStreamKey);
  }
}

export class ThreadsHandlers {
  constructor(
    private readonly threads: ThreadsPort,
    private readonly agent: AgentRepliesPort,
    private readonly defaultStreamKey: string,
  ) {}

  list(streamKey?: string) { return this.threads.listThreads(streamKey || this.defaultStreamKey); }

  get(id: string) { return this.threads.getThread(id); }

  ack(id: string, command: Record<string, unknown>) {
    return this.threads.ack(id, command.actor);
  }

  snooze(id: string, command: Record<string, unknown>) {
    return this.threads.snooze(id, command.actor, command.delaySeconds);
  }

  reply(id: string, command: Record<string, unknown>) {
    return this.agent.publishUserReply(id, command.actor, command.message);
  }
}

export class StreamsHandlers {
  constructor(
    private readonly streams: StreamsPort,
    private readonly defaultStreamKey: string,
  ) {}

  getHighWaterMark(streamKey?: string) {
    return this.streams.getHighWaterMark(streamKey || this.defaultStreamKey);
  }

  listMessages(
    streamKey: string | undefined,
    afterId: string,
    throughId?: string,
    limit?: number,
  ) {
    return this.streams.listMessages(
      streamKey || this.defaultStreamKey,
      afterId,
      throughId,
      limit,
    );
  }
}

export const createTriageHandlers = (
  triage: TriagePort,
  defaultStreamKey: string,
): TriageHandlers => new TriageHandlers(triage, defaultStreamKey);

export const createThreadsHandlers = (
  threads: ThreadsPort,
  agent: AgentRepliesPort,
  defaultStreamKey: string,
): ThreadsHandlers => new ThreadsHandlers(threads, agent, defaultStreamKey);

export const createStreamsHandlers = (
  streams: StreamsPort,
  defaultStreamKey: string,
): StreamsHandlers => new StreamsHandlers(streams, defaultStreamKey);
