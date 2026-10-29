export const ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ILLEGAL_TRANSITION: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code];
  }
}

export class ValidationError extends AppError {
  readonly fields: Record<string, string>;

  constructor(message: string, fields?: Record<string, string>) {
    super(ERROR_CODES.VALIDATION_FAILED, message);
    this.name = "ValidationError";
    this.fields = fields ?? {};
  }
}

export class IllegalTransitionError extends AppError {
  constructor(machine: string, from: string, to: string) {
    super(
      ERROR_CODES.ILLEGAL_TRANSITION,
      `非法状态迁移: ${machine} ${from} -> ${to}`,
    );
    this.name = "IllegalTransitionError";
  }
}

export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | ActionFailure;
