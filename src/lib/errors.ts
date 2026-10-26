/** A failure the user can act on (validation, business rule, permission). Its message is safe to show. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string = "APP_ERROR",
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class PermissionError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, "FORBIDDEN");
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "CONFLICT", details);
  }
}
