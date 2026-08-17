import type {
  Priority,
  RoutingDelivery,
  TargetKind,
  TargetSnapshot,
} from "database/routing";
import { RoutingUtils, type RoutingScheduleConfig } from "../routing.utils.js";

export interface TargetDispatcher {
  supports(kind: TargetKind): boolean;
  createDelivery(
    target: TargetSnapshot,
    priority: Priority,
    now: Date,
  ): RoutingDelivery;
}

export class QueueTargetDispatcher implements TargetDispatcher {
  constructor(private readonly schedule: RoutingScheduleConfig) {}

  supports(kind: TargetKind): boolean {
    return kind === "queue";
  }

  createDelivery(
    target: TargetSnapshot,
    priority: Priority,
    now: Date,
  ): RoutingDelivery {
    if (!target.queue) throw new Error(`Queue target ${target.id} has no available queue`);
    return {
      kind: "queue",
      queueId: target.queue.id,
      messageGroupId: target.queue.name,
      visibleAt: RoutingUtils.computeVisibleAt(
        priority,
        target.queue,
        now,
        this.schedule,
      ).toISOString(),
    };
  }
}

export class SseTargetDispatcher implements TargetDispatcher {
  supports(kind: TargetKind): boolean {
    return kind === "sse";
  }

  createDelivery(target: TargetSnapshot): RoutingDelivery {
    const streamKey = target.config.streamKey;
    if (typeof streamKey !== "string" || streamKey.length === 0) {
      throw new Error(`SSE target ${target.id} has no streamKey`);
    }
    return { kind: "sse", streamKey };
  }
}

export class SmsTargetDispatcher implements TargetDispatcher {
  supports(kind: TargetKind): boolean {
    return kind === "sms";
  }

  createDelivery(): RoutingDelivery {
    return { kind: "sms" };
  }
}

export function createTargetDispatchers(
  schedule: RoutingScheduleConfig,
): TargetDispatcher[] {
  return [
    new QueueTargetDispatcher(schedule),
    new SseTargetDispatcher(),
    new SmsTargetDispatcher(),
  ];
}
