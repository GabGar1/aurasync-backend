/**
 * Domain errors carry the HTTP status they map to. Services throw them and the
 * global error handler (lib/error-handler.ts) turns them into `{ error }` responses,
 * so routers do not need their own try/catch.
 */
export class AppError extends Error {
  constructor(message: string, public readonly statusCode: number, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden: You do not have permission to perform this action.') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}
