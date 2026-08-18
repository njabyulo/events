export class AgentValidationError extends Error {
  readonly code = "invalid_agent_input";

  constructor(message: string) {
    super(message);
    this.name = "AgentValidationError";
  }
}

export class AgentNotFoundError extends Error {
  readonly code = "agent_thread_not_found";

  constructor(message = "Thread does not exist") {
    super(message);
    this.name = "AgentNotFoundError";
  }
}
