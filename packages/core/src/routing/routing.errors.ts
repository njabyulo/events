export class RoutingValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RoutingValidationError";
  }
}

export class RoutingNotFoundError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RoutingNotFoundError";
  }
}

export class RoutingConflictError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RoutingConflictError";
  }
}

export class RoutingStoreUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super("Routing store is unavailable");
    this.name = "RoutingStoreUnavailableError";
  }
}

export class RoutingLeaseLostError extends Error {
  constructor(eventId: string) {
    super(`Routing lease for event ${eventId} was lost`);
    this.name = "RoutingLeaseLostError";
  }
}
