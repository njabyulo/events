import type { EscalationsService } from "core/escalations";

type EscalationsPort = Pick<EscalationsService,
  "list" | "listAttempts" | "dismiss" | "retry"
>;

export class EscalationsHandlers {
  constructor(private readonly escalations: EscalationsPort) {}

  list() { return this.escalations.list(); }
  listAttempts(id: string) { return this.escalations.listAttempts(id); }
  dismiss(id: string, command: Record<string, unknown>) {
    return this.escalations.dismiss(id, command.actor, command.reason);
  }
  retry(id: string, command: Record<string, unknown>) {
    return this.escalations.retry(id, command.actor, command.reason);
  }
}

export const createEscalationsHandlers = (
  escalations: EscalationsPort,
): EscalationsHandlers => new EscalationsHandlers(escalations);
