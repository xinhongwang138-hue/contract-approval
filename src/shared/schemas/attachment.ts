import { z } from "zod";

export const ATTACHMENT_KINDS = [
  "body",
  "appendix",
  "seal_proof",
  "other",
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  body: "合同正文",
  appendix: "附件",
  seal_proof: "用印凭证",
  other: "其他",
};

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const ATTACHMENT_ALLOWED_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "png",
  "jpg",
] as const;

export type AttachmentExtension = (typeof ATTACHMENT_ALLOWED_EXTENSIONS)[number];

export const ATTACHMENT_MIME_TYPES: Record<
  AttachmentExtension,
  readonly string[]
> = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  xls: ["application/vnd.ms-excel"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  png: ["image/png"],
  jpg: ["image/jpeg"],
};

const EXTENSION_SET = new Set<string>(ATTACHMENT_ALLOWED_EXTENSIONS);

export function isAllowedExtension(
  extension: string,
): extension is AttachmentExtension {
  return EXTENSION_SET.has(extension);
}

export function getFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) {
    return null;
  }
  return fileName.slice(dot + 1).toLowerCase();
}

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "" || cleaned === "." || cleaned === "..") {
    return "attachment";
  }
  return cleaned.length > 120 ? cleaned.slice(-120) : cleaned;
}

export const attachmentKindSchema = z.enum(ATTACHMENT_KINDS);
