export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, string>;

  public constructor(
    code: string,
    message: string,
    status = 400,
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function asAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  return new AppError(
    "INTERNAL_ERROR",
    "The request could not be completed. Please try again.",
    500,
  );
}
