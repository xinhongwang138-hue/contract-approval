import { recordAudit } from "@/server/audit";
import { getAccessContext } from "@/server/auth/access";
import { requireAuth } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import {
  exportMaxRows,
  getContractLedger,
  toCsv,
  toXlsx,
} from "@/server/services/contract-export";
import { ZodError } from "zod";
import { contractListQuerySchema } from "@/shared/schemas/contract";
import { AppError, ERROR_CODES } from "@/shared/errors";

const FORMATS = {
  csv: {
    mime: "text/csv; charset=utf-8",
    extension: "csv",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
  },
} as const;

function contentDisposition(base: string, extension: string): string {
  const full = `${base}.${extension}`;
  const ascii = full.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { user } = await requireAuth();
    const access = await getAccessContext(user.id);

    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "csv";
    const spec = format === "xlsx" ? FORMATS.xlsx : format === "csv" ? FORMATS.csv : null;
    if (!spec) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "导出格式只支持 csv 或 xlsx");
    }

    const query = contractListQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      order: url.searchParams.get("order") ?? undefined,
    });

    const ledger = await getContractLedger(
      access,
      {
        ...(query.q ? { q: query.q } : {}),
        ...(query.status ? { status: query.status } : {}),
        sort: query.sort,
        order: query.order,
      },
      exportMaxRows(process.env.CONTRACT_EXPORT_MAX_ROWS),
    );

    const body =
      spec.extension === "csv"
        ? toCsv(ledger.columns, ledger.rows)
        : toXlsx(ledger);
    const bytes = typeof body === "string" ? Buffer.from(body, "utf8") : body;

    await recordAudit(prisma, {
      actorId: user.id,
      action: "contract.export",
      entity: "Contract",
      entityId: "ledger",
      before: undefined,
      after: {
        format: spec.extension,
        rows: ledger.rows.length,
        filters: { q: query.q ?? null, status: query.status ?? null },
      },
    });

    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": spec.mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDisposition(ledger.fileName, spec.extension),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(
        { ok: false, code: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof ZodError) {
      return Response.json(
        {
          ok: false,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: error.issues[0]?.message ?? "导出参数不合法",
        },
        { status: 422 },
      );
    }
    return Response.json(
      { ok: false, code: ERROR_CODES.INTERNAL, message: "导出失败，请稍后再试" },
      { status: 500 },
    );
  }
}
