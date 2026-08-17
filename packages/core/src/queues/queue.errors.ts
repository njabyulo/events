export class QueueValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "QueueValidationError";
    this.code = code;
  }
}

export class QueueNotFoundError extends Error {
  readonly code = "queue_not_found";

  constructor(message = "Queue or event does not exist") {
    super(message);
    this.name = "QueueNotFoundError";
  }
}

export class QueueLeaseConflictError extends Error {
  readonly code = "queue_lease_conflict";

  constructor(message = "The message lease is missing, stale, or expired") {
    super(message);
    this.name = "QueueLeaseConflictError";
  }
}

export class QueueInUseError extends Error {
  readonly code = "queue_in_use";

  constructor() {
    super("Queue still has messages or an attached target");
    this.name = "QueueInUseError";
  }
}

export class QueueConflictError extends Error {
  readonly code = "queue_conflict";

  constructor(message = "An active queue already uses this name") {
    super(message);
    this.name = "QueueConflictError";
  }
}

export class QueueStoreUnavailableError extends Error {
  readonly code = "queue_store_unavailable";

  constructor(cause: unknown) {
    super("Queue storage is unavailable", { cause });
    this.name = "QueueStoreUnavailableError";
  }
}
