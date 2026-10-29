import { createHash } from "node:crypto";
import type { AccessContext } from "@/server/auth/access";
import { requireContractAccess } from "@/server/auth/access";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/server/db/client";
import { requireEditableContract } from "@/server/services/contract";
import { saveStoredFile } from "@/server/storage/local-storage";
import { AppError, ERROR_CODES, ValidationError } from "@/shared/errors";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_TYPES,
  getFileExtension,
  isAllowedExtension,
  sanitizeFileName,
  type AttachmentExtension,
  type AttachmentKind,
} from "@/shared/schemas/attachment";

type Container = "pdf" | "png" | "jpg" | "ole" | "zip" | null;

function detectContainer(buffer: Buffer): Container {
  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString("latin1") === "%PDF-"
  ) {
    return "pdf";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpg";
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    return "ole";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  ) {
    return "zip";
  }
  return null;
}

function zipContains(buffer: Buffer, needle: string): boolean {
  return buffer.includes(Buffer.from(needle, "latin1"));
}

function matchesSignature(
  extension: AttachmentExtension,
  buffer: Buffer,
): boolean {
  const container = detectContainer(buffer);
  switch (extension) {
    case "pdf":
      return container === "pdf";
    case "png":
      return container === "png";
    case "jpg":
      return container === "jpg";
    case "doc":
    case "xls":
      return container === "ole";
    case "docx":
      return (
        container === "zip" &&
        zipContains(buffer, "[Content_Types].xml") &&
        zipContains(buffer, "word/")
      );
    case "xlsx":
      return (
        container === "zip" &&
        zipContains(buffer, "[Content_Types].xml") &&
        zipContains(buffer, "xl/")
      );
  }
}

export async function uploadAttachment(
  access: AccessContext,
  input: {
    contractId: string;
    kind: AttachmentKind;
    file: File;
  },
): Promise<{ id: string; name: string }> {
  await requireEditableContract(access, input.contractId);

  const name = sanitizeFileName(input.file.name);
  const extension = getFileExtension(name);
  if (!extension || !isAllowedExtension(extension)) {
    throw new ValidationError(
      "仅支持 pdf/doc/docx/xls/xlsx/png/jpg 文件",
      { file: "仅支持 pdf/doc/docx/xls/xlsx/png/jpg 文件" },
    );
  }

  if (input.file.size === 0) {
    throw new ValidationError("文件不能为空", { file: "文件不能为空" });
  }
  if (input.file.size > ATTACHMENT_MAX_BYTES) {
    throw new ValidationError("单个文件不能超过 20MB", {
      file: "单个文件不能超过 20MB",
    });
  }

  const [rawMime] = (input.file.type || "").split(";");
  const declaredMime = (rawMime ?? "").trim().toLowerCase();
  const allowedMimes = ATTACHMENT_MIME_TYPES[extension];
  if (!allowedMimes.includes(declaredMime)) {
    throw new ValidationError("文件类型与扩展名不匹配", {
      file: "文件类型与扩展名不匹配",
    });
  }

  const buffer = Buffer.from(await input.file.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new ValidationError("文件大小不合法", { file: "文件大小不合法" });
  }
  if (!matchesSignature(extension, buffer)) {
    throw new ValidationError("文件内容与扩展名不匹配", {
      file: "文件内容与扩展名不匹配",
    });
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const existing = await prisma.attachment.findFirst({
    where: { sha256 },
    select: { storageKey: true },
  });

  let storageKey: string;
  if (existing) {
    storageKey = existing.storageKey;
  } else {
    const saved = await saveStoredFile(buffer, extension);
    storageKey = saved.storageKey;
  }

  return prisma.$transaction(async (tx) => {
    const attachment = await tx.attachment.create({
      data: {
        contractId: input.contractId,
        kind: input.kind,
        storageKey,
        sha256,
        name,
        mime: ATTACHMENT_MIME_TYPES[extension][0] ?? declaredMime,
        size: buffer.byteLength,
        uploadedBy: access.userId,
        updatedBy: access.userId,
      },
      select: { id: true, name: true },
    });

    await recordAudit(tx, {
      actorId: access.userId,
      action: "attachment.upload",
      entity: "Attachment",
      entityId: attachment.id,
      after: {
        contractId: input.contractId,
        name: attachment.name,
        kind: input.kind,
        sha256,
        size: buffer.byteLength,
      },
    });

    return attachment;
  });
}

export async function deleteAttachment(
  access: AccessContext,
  attachmentId: string,
): Promise<{ id: string; contractId: string }> {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, deletedAt: null },
    select: {
      id: true,
      contractId: true,
      name: true,
      storageKey: true,
      sha256: true,
    },
  });
  if (!attachment) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "附件不存在");
  }

  await requireEditableContract(access, attachment.contractId);

  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({
      where: { id: attachment.id },
      data: { deletedAt: new Date(), updatedBy: access.userId },
    });
    await recordAudit(tx, {
      actorId: access.userId,
      action: "attachment.delete",
      entity: "Attachment",
      entityId: attachment.id,
      before: {
        contractId: attachment.contractId,
        name: attachment.name,
        sha256: attachment.sha256,
      },
    });
  });

  return { id: attachment.id, contractId: attachment.contractId };
}

export async function getAttachmentForDownload(
  userId: string,
  attachmentId: string,
): Promise<{
  storageKey: string;
  name: string;
  mime: string;
  size: number;
}> {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, deletedAt: null },
    select: {
      id: true,
      contractId: true,
      storageKey: true,
      name: true,
      mime: true,
      size: true,
    },
  });
  if (!attachment) {
    throw new AppError(ERROR_CODES.NOT_FOUND, "附件不存在");
  }

  await requireContractAccess(userId, attachment.contractId, "read");

  return {
    storageKey: attachment.storageKey,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
  };
}
