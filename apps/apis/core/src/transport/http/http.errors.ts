export class HttpInputError extends Error {
  readonly code = "invalid_payload";

  constructor(message: string) {
    super(message);
    this.name = "HttpInputError";
  }
}
