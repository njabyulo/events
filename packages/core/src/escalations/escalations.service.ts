import type {
  ClaimedEscalation,
  EscalationActionResult,
  EscalationAttemptRecord,
  EscalationRecord,
  EscalationsRepo,
} from "database/escalations";
import { EscalationsUtils } from "./escalations.utils.js";
import {
  EscalationConflictError,
  EscalationNotFoundError,
} from "./escalation.errors.js";

export type EscalationsRepository = Pick<EscalationsRepo,
  | "list"
  | "listAttempts"
  | "claimNext"
  | "reserveSendCapacity"
  | "markSent"
  | "markFailed"
  | "rateLimit"
  | "dismiss"
  | "retry"
>;

export type SmsSendResult = { sid: string };

export interface SmsClient {
  send(body: string): Promise<SmsSendResult>;
}

export class SmsDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SmsDeliveryError";
  }
}

export type EscalationsServiceConfig = {
  leaseSeconds: number;
  maxAttempts: number;
  rateLimitPerHour: number;
  rateLimitPerDay: number;
};

export class EscalationsService {
  constructor(
    private readonly repository: EscalationsRepository,
    private readonly smsClient: SmsClient,
    private readonly config: EscalationsServiceConfig,
    private readonly clock: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {}

  async runOnce(): Promise<"idle" | "sent" | "retry_scheduled" | "failed" | "rate_limited" | "lease_lost"> {
    const escalation = await this.repository.claimNext(this.config.leaseSeconds);
    if (!escalation) return "idle";

    const reservation = await this.repository.reserveSendCapacity(
      escalation.id,
      escalation.leaseToken,
      {
        perHour: this.config.rateLimitPerHour,
        perDay: this.config.rateLimitPerDay,
        maxAttempts: this.config.maxAttempts,
      },
    );
    if (reservation.status === "lease_lost") return "lease_lost";
    if (reservation.status === "attempts_exhausted") {
      return await this.repository.markFailed(
        escalation.id,
        escalation.leaseToken,
        {
          retry: false,
          delaySeconds: 0,
          error: "SMS delivery attempt budget was exhausted",
        },
      ) ? "failed" : "lease_lost";
    }
    if (reservation.status === "rate_limited") {
      return await this.repository.rateLimit(
        escalation.id,
        escalation.leaseToken,
        reservation.delaySeconds,
      ) ? "rate_limited" : "lease_lost";
    }
    const attemptCount = reservation.attemptCount;

    try {
      const result = await this.smsClient.send(
        EscalationsUtils.smsBody(escalation, this.clock()),
      );
      return await this.repository.markSent(
        escalation.id,
        escalation.leaseToken,
        result.sid,
      ) ? "sent" : "lease_lost";
    } catch (error) {
      const retryable = !(error instanceof SmsDeliveryError) || error.retryable;
      const retry = retryable && attemptCount < this.config.maxAttempts;
      const computedDelay = EscalationsUtils.retryDelaySeconds(
        attemptCount,
        this.random,
      );
      const retryAfter = error instanceof SmsDeliveryError
        ? error.retryAfterSeconds ?? 0
        : 0;
      const delaySeconds = Math.max(computedDelay, retryAfter);
      const updated = await this.repository.markFailed(
        escalation.id,
        escalation.leaseToken,
        {
          retry,
          delaySeconds,
          error: EscalationsUtils.boundedError(error),
        },
      );
      if (!updated) return "lease_lost";
      return retry ? "retry_scheduled" : "failed";
    }
  }

  async drain(maxItems = 100): Promise<number> {
    let processed = 0;
    while (processed < maxItems) {
      const result = await this.runOnce();
      if (result === "idle") break;
      processed += 1;
    }
    return processed;
  }

  list(limitValue: unknown = 100, beforeId?: unknown): Promise<EscalationRecord[]> {
    const limit = Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
      throw new RangeError("Escalation limit must be from 1 to 250");
    }
    const cursor = beforeId === undefined
      ? undefined
      : EscalationsUtils.positiveId(beforeId, "before_id");
    return this.repository.list(limit, cursor);
  }

  listAttempts(id: string): Promise<EscalationAttemptRecord[]> {
    return this.repository.listAttempts(id);
  }

  async dismiss(id: string, actor: unknown, reason: unknown): Promise<void> {
    this.assertAction(await this.repository.dismiss(
      id,
      EscalationsUtils.requiredText(actor, "actor", 120),
      EscalationsUtils.requiredText(reason, "reason", 1_000),
    ));
  }

  async retry(id: string, actor: unknown, reason: unknown): Promise<void> {
    this.assertAction(await this.repository.retry(
      id,
      EscalationsUtils.requiredText(actor, "actor", 120),
      EscalationsUtils.requiredText(reason, "reason", 1_000),
    ));
  }

  private assertAction(result: EscalationActionResult): void {
    if (result === "not_found") throw new EscalationNotFoundError();
    if (result === "stale") throw new EscalationConflictError();
  }
}

export const createEscalationsService = (
  repository: EscalationsRepository,
  smsClient: SmsClient,
  config: EscalationsServiceConfig,
  options: { clock?: () => Date; random?: () => number } = {},
): EscalationsService => new EscalationsService(
  repository,
  smsClient,
  config,
  options.clock,
  options.random,
);
