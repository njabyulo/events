import type {
  JsonObject,
  QueueRecord,
  TargetKind,
  TargetRecord,
} from "database/routing";
import type { TargetsRepo } from "database/targets";
import {
  RoutingConflictError,
  RoutingNotFoundError,
  RoutingStoreUnavailableError,
  RoutingValidationError,
} from "./routing.errors.js";
import { TargetsUtils, type SmsTargetReadiness } from "./targets.utils.js";

export type CreateTargetCommand = {
  name: unknown;
  kind: unknown;
  config?: unknown;
  enabled?: unknown;
};

export type UpdateTargetCommand = {
  name?: unknown;
  kind?: unknown;
  config?: unknown;
  enabled?: unknown;
};

export type TargetsRepository = Pick<
  TargetsRepo,
  | "listTargets"
  | "getTarget"
  | "listQueues"
  | "getQueue"
  | "streamKeyExists"
  | "createTarget"
  | "updateTarget"
  | "setEnabled"
  | "deleteTarget"
  | "scheduleTargetTest"
>;

export type TargetsServiceDependencies = {
  targetsRepository: TargetsRepository;
  smsReadiness: SmsTargetReadiness;
};

export class TargetsService {
  constructor(private readonly dependencies: TargetsServiceDependencies) {}

  async listTargets(): Promise<TargetRecord[]> {
    const targets = await this.run(() => this.dependencies.targetsRepository.listTargets());
    return targets.map(TargetsUtils.publicTarget);
  }

  async getTarget(id: string): Promise<TargetRecord> {
    const target = await this.run(() => this.dependencies.targetsRepository.getTarget(id));
    if (!target) throw new RoutingNotFoundError("target_not_found", "Target does not exist");
    return TargetsUtils.publicTarget(target);
  }

  async listQueues(): Promise<QueueRecord[]> {
    return this.run(() => this.dependencies.targetsRepository.listQueues());
  }

  async createTarget(command: CreateTargetCommand): Promise<TargetRecord> {
    const name = TargetsUtils.normalizeName(command.name);
    const kind = TargetsUtils.normalizeKind(command.kind);
    const config = TargetsUtils.normalizeConfig(command.config);
    const enabled = TargetsUtils.normalizeEnabled(command.enabled, false);
    await this.validate(kind, config, enabled);

    try {
      const created = await this.dependencies.targetsRepository.createTarget({
        name,
        kind,
        config,
        enabled,
      });
      return TargetsUtils.publicTarget(created);
    } catch (error) {
      if (TargetsUtils.isUniqueViolation(error)) {
        throw new RoutingConflictError(
          "target_conflict",
          "An active target uses this name or SSE stream key",
        );
      }
      throw new RoutingStoreUnavailableError(error);
    }
  }

  async updateTarget(id: string, command: UpdateTargetCommand): Promise<TargetRecord> {
    const existing = await this.getTarget(id);
    TargetsUtils.assertEditableName(existing.name);

    const name = command.name === undefined
      ? existing.name
      : TargetsUtils.normalizeName(command.name);
    const kind = command.kind === undefined
      ? existing.kind
      : TargetsUtils.normalizeKind(command.kind);
    const config = command.config === undefined
      ? existing.config
      : TargetsUtils.normalizeConfig(command.config);
    const enabled = TargetsUtils.normalizeEnabled(command.enabled, existing.enabled);
    await this.validate(kind, config, enabled, id);

    try {
      const updated = await this.dependencies.targetsRepository.updateTarget(id, {
        name,
        kind,
        config,
        enabled,
      });
      if (!updated) throw new RoutingNotFoundError("target_not_found", "Target does not exist");
      return TargetsUtils.publicTarget(updated);
    } catch (error) {
      if (error instanceof RoutingNotFoundError) throw error;
      if (TargetsUtils.isUniqueViolation(error)) {
        throw new RoutingConflictError(
          "target_conflict",
          "An active target uses this name or SSE stream key",
        );
      }
      throw new RoutingStoreUnavailableError(error);
    }
  }

  async enableTarget(id: string): Promise<TargetRecord> {
    const existing = await this.getTarget(id);
    TargetsUtils.assertEditableName(existing.name);
    await this.validate(existing.kind, existing.config, true, id);
    const enabled = await this.run(
      () => this.dependencies.targetsRepository.setEnabled(id, true),
    );
    if (!enabled) throw new RoutingNotFoundError("target_not_found", "Target does not exist");
    return TargetsUtils.publicTarget(enabled);
  }

  async disableTarget(id: string): Promise<TargetRecord> {
    const existing = await this.getTarget(id);
    TargetsUtils.assertEditableName(existing.name);
    const disabled = await this.run(
      () => this.dependencies.targetsRepository.setEnabled(id, false),
    );
    if (!disabled) throw new RoutingNotFoundError("target_not_found", "Target does not exist");
    return TargetsUtils.publicTarget(disabled);
  }

  async deleteTarget(id: string): Promise<void> {
    const existing = await this.getTarget(id);
    TargetsUtils.assertEditableName(existing.name);
    const result = await this.run(() => this.dependencies.targetsRepository.deleteTarget(id));
    if (result === "not_found") {
      throw new RoutingNotFoundError("target_not_found", "Target does not exist");
    }
    if (result === "in_use") {
      throw new RoutingConflictError(
        "target_in_use",
        "Disable or detach the target from active rules before deleting it",
      );
    }
  }

  async testTarget(
    id: string,
    actor: unknown,
    reason: unknown,
  ): Promise<{ testId: string; status: "scheduled" }> {
    const target = await this.getTarget(id);
    TargetsUtils.assertEditableName(target.name);
    if (!target.enabled) {
      throw new RoutingConflictError(
        "target_disabled",
        "Enable the target before scheduling a test delivery",
      );
    }
    await this.validate(target.kind, target.config, true, id);
    const normalizedActor = this.requiredText(actor, "actor", 320);
    const normalizedReason = this.requiredText(reason, "reason", 1_000);
    const testId = await this.run(
      () => this.dependencies.targetsRepository.scheduleTargetTest(
        target,
        normalizedActor,
        normalizedReason,
      ),
    );
    return { testId, status: "scheduled" };
  }

  private async validate(
    kind: TargetKind,
    config: JsonObject,
    enabled: boolean,
    targetId?: string,
  ): Promise<void> {
    if (kind === "queue") {
      const queueId = config.queueId;
      const queue = typeof queueId === "string" || typeof queueId === "number"
        ? await this.run(() => this.dependencies.targetsRepository.getQueue(String(queueId)))
        : null;
      TargetsUtils.validateQueueConfig(config, queue);
      return;
    }

    if (kind === "sse") {
      TargetsUtils.validateSseConfig(config);
      const streamKey = String(config.streamKey);
      if (await this.run(
        () => this.dependencies.targetsRepository.streamKeyExists(streamKey, targetId),
      )) {
        throw new RoutingConflictError(
          "sse_stream_key_conflict",
          "SSE streamKey is already in use",
        );
      }
      return;
    }

    TargetsUtils.validateSmsConfig(config, enabled, this.dependencies.smsReadiness);
  }

  private requiredText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RoutingValidationError(`invalid_${field}`, `${field} is required`);
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
      throw new RoutingValidationError(`invalid_${field}`, `${field} is too long`);
    }
    return normalized;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof RoutingNotFoundError
        || error instanceof RoutingConflictError
      ) throw error;
      throw new RoutingStoreUnavailableError(error);
    }
  }
}

export const createTargetsService = (
  dependencies: TargetsServiceDependencies,
): TargetsService => new TargetsService(dependencies);
