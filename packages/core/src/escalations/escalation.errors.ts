export class EscalationValidationError extends Error {
  readonly code = "invalid_escalation_action";

  constructor(message: string) {
    super(message);
    this.name = "EscalationValidationError";
  }
}

export class EscalationNotFoundError extends Error {
  readonly code = "escalation_not_found";

  constructor() {
    super("Escalation does not exist");
    this.name = "EscalationNotFoundError";
  }
}

export class EscalationConflictError extends Error {
  readonly code = "escalation_conflict";

  constructor() {
    super("Escalation is currently leased or not retryable");
    this.name = "EscalationConflictError";
  }
}
