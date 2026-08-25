/**
 * Typed error hierarchy (plan Section 21.6). Every mutating operation throws
 * one of these; route/action handlers translate them into safe, plainlanguage responses. Never let a raw database or stack-trace message reach
 * the browser.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Malformed or out-of-range input. Every failing field is named, not just the first. */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
  }
}

/** Permission-kernel refusal. The client sees "not available to your role". */
export class ForbiddenError extends AppError {}

/** Wrong semester state or record status for the requested action. */
export class StateError extends AppError {}

/** Stale optimistic-concurrency token, or a competing decision on the same record. */
export class ConflictError extends AppError {
  constructor(
    message: string,
    public readonly changedBy?: string,
  ) {
    super(message);
  }
}

/** Missing record, or a record the actor may not see. Deliberately identical to a real 404. */
export class NotFoundError extends AppError {}

/** A database constraint was reached that a service-level check should have caught first. Always logged as a defect. */
export class IntegrityError extends AppError {}
