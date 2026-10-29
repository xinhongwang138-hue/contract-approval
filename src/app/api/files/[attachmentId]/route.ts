import { Readable } from "node:stream";
import { requireAuth } from "@/server/auth/session";
import { getAttachmentForDownload } from "@/server/services/attachment";
import { openStoredFile } from "@/server/storage/local-storage";
import { AppError, ERROR_CODES } from "@/shared/errors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  try {
    const { user } = await requireAuth();
    const { attachmentId } = await params;
    const file = await getAttachmentForDownload(user.id, attachmentId);

    const asciiName = file.name
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_");
    const stream = openStoredFile(file.storageKey);

    return new Response(
      Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
      {
        headers: {
          "Content-Type": file.mime,
          "Content-Length": String(file.size),
          "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return Response.json(
        { ok: false, code: error.code, message: error.message },
        { status: error.status },
      );
    }
    return Response.json(
      {
        ok: false,
        code: ERROR_CODES.INTERNAL,
        message: "文件下载失败",
      },
      { status: 500 },
    );
  }
}
