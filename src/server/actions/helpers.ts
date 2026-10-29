import type { ZodError } from "zod";
import {
  AppError,
  ERROR_CODES,
  ValidationError,
  type ActionFailure,
} from "@/shared/errors";

export function zodFailure(error: ZodError): ActionFailure {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fields[key]) {
      fields[key] = issue.message;
    }
  }
  return {
    ok: false,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: error.issues[0]?.message ?? "输入有误",
    fields: Object.keys(fields).length > 0 ? fields : undefined,
  };
}

export function toFailure(error: unknown): ActionFailure {
  if (error instanceof AppError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      fields:
        error instanceof ValidationError &&
        Object.keys(error.fields).length > 0
          ? error.fields
          : undefined,
    };
  }
  return {
    ok: false,
    code: ERROR_CODES.INTERNAL,
    message: "操作失败，请稍后再试",
    fields: undefined,
  };
}
