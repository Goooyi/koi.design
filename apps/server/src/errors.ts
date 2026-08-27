export type RepositoryErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "CAPACITY_EXCEEDED"
  | "SERVER_BUSY"
  | "CORRUPT_DATA";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositoryError";
    this.code = code;
  }
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the configured limit");
    this.name = "PayloadTooLargeError";
  }
}

export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super("Expected an application/json request body");
    this.name = "UnsupportedMediaTypeError";
  }
}

export class InvalidJsonError extends Error {
  constructor(message = "Request body is not valid JSON") {
    super(message);
    this.name = "InvalidJsonError";
  }
}
