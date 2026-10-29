import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { getAccessContext } from "@/server/auth/access";
import {
  createContract,
  requireEditableContract,
} from "@/server/services/contract";
import {
  deleteAttachment,
  getAttachmentForDownload,
  uploadAttachment,
} from "@/server/services/attachment";
import { getStorageDir } from "@/server/storage/local-storage";
import { ATTACHMENT_MAX_BYTES } from "@/shared/schemas/attachment";
import type { ContractDraftInput } from "@/shared/schemas/contract";
import {
  createTestParty,
  createTestTemplate,
  createTestUser,
  ensureContractType,
  ensureTestDepartment,
  prepareDatabase,
  resetContractData,
  uniqueSuffix,
} from "../helpers/fixtures";

const suffix = uniqueSuffix();

let employeeId = "";
let outsiderId = "";
let contractId = "";
let draftInput: ContractDraftInput;

function pdfFile(name = "合同正文.pdf", content = "%PDF-1.7\n测试正文"): File {
  return new File([Buffer.from(content)], name, { type: "application/pdf" });
}

beforeAll(async () => {
  await prepareDatabase();
  await resetContractData();

  const hq = await ensureTestDepartment();
  const employee = await createTestUser({
    name: "附件员工",
    email: `attachment-${suffix.toLowerCase()}@test.local`,
    roleKey: "employee",
    departmentId: hq.id,
  });
  const outsider = await createTestUser({
    name: "附件外人",
    email: `attachment-out-${suffix.toLowerCase()}@test.local`,
    roleKey: "employee",
    departmentId: hq.id,
  });
  employeeId = employee.id;
  outsiderId = outsider.id;

  const partyA = await createTestParty(`附件甲方${suffix}`);
  const partyB = await createTestParty(`附件乙方${suffix}`);
  const type = await ensureContractType(
    `att_type_${suffix.toLowerCase()}`,
    "附件测试类型",
  );
  const template = await createTestTemplate({
    code: `A${suffix}`,
    name: "附件测试模板",
    fields: [],
  });

  draftInput = {
    templateId: template.id,
    typeId: type.id,
    title: "附件测试合同",
    partyAId: partyA.id,
    partyBId: partyB.id,
    amount: "1000.00",
    currency: "CNY",
    signDate: "2026-10-01",
    startDate: "2026-10-01",
    endDate: "2027-09-30",
    formData: {},
    bodyMarkdown: "",
  };

  const access = await getAccessContext(employeeId);
  contractId = (await createContract(access, draftInput)).id;
});

describe("attachment security", () => {
  it("stores a valid PDF under a random uuid key", async () => {
    const access = await getAccessContext(employeeId);
    const file = pdfFile();
    const created = await uploadAttachment(access, {
      contractId,
      kind: "body",
      file,
    });

    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.name).toBe("合同正文.pdf");
    expect(row.storageKey).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(row.sha256).toHaveLength(64);
    expect(row.size).toBe(file.size);
    expect(existsSync(path.join(getStorageDir(), row.storageKey))).toBe(true);
  });

  it("deduplicates identical content by sha256", async () => {
    const access = await getAccessContext(employeeId);
    const content = "%PDF-1.7\n完全相同的正文";
    const first = await uploadAttachment(access, {
      contractId,
      kind: "appendix",
      file: pdfFile("版本一.pdf", content),
    });
    const second = await uploadAttachment(access, {
      contractId,
      kind: "appendix",
      file: pdfFile("版本二.pdf", content),
    });

    const rows = await prisma.attachment.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { storageKey: true, sha256: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.storageKey).toBe(rows[1]?.storageKey);
    expect(rows[0]?.sha256).toBe(rows[1]?.sha256);
  });

  it("rejects disguised extensions and mime mismatches", async () => {
    const access = await getAccessContext(employeeId);
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);

    await expect(
      uploadAttachment(access, {
        contractId,
        kind: "appendix",
        file: new File([pngBytes], "伪装.pdf", { type: "application/pdf" }),
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: "文件内容与扩展名不匹配",
    });

    await expect(
      uploadAttachment(access, {
        contractId,
        kind: "appendix",
        file: new File([Buffer.from("MZ")], "木马.pdf", {
          type: "application/pdf",
        }),
      }),
    ).rejects.toMatchObject({ message: "文件内容与扩展名不匹配" });

    await expect(
      uploadAttachment(access, {
        contractId,
        kind: "appendix",
        file: new File(["%PDF-1.7"], "正文.pdf", { type: "image/png" }),
      }),
    ).rejects.toMatchObject({ message: "文件类型与扩展名不匹配" });

    await expect(
      uploadAttachment(access, {
        contractId,
        kind: "appendix",
        file: new File(["data"], "脚本.exe", {
          type: "application/octet-stream",
        }),
      }),
    ).rejects.toMatchObject({ message: "仅支持 pdf/doc/docx/xls/xlsx/png/jpg 文件" });
  });

  it("rejects files above 20MB", async () => {
    const access = await getAccessContext(employeeId);
    const big = Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 0x25);
    await expect(
      uploadAttachment(access, {
        contractId,
        kind: "appendix",
        file: new File([big], "超大.pdf", { type: "application/pdf" }),
      }),
    ).rejects.toMatchObject({ message: "单个文件不能超过 20MB" });
  });

  it("enforces scope on download and rejects unknown attachments", async () => {
    const access = await getAccessContext(employeeId);
    const created = await uploadAttachment(access, {
      contractId,
      kind: "body",
      file: pdfFile("下载测试.pdf", "%PDF-1.7\ndownload"),
    });

    const file = await getAttachmentForDownload(employeeId, created.id);
    expect(file.mime).toBe("application/pdf");
    expect(file.name).toBe("下载测试.pdf");

    await expect(
      getAttachmentForDownload(outsiderId, created.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      getAttachmentForDownload(employeeId, "not-exists"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blocks uploads and deletions once the contract leaves draft", async () => {
    const access = await getAccessContext(employeeId);
    const created = await uploadAttachment(access, {
      contractId,
      kind: "appendix",
      file: pdfFile("状态测试.pdf", "%PDF-1.7\nstate"),
    });

    await prisma.contract.update({
      where: { id: contractId },
      data: { status: "approving" },
    });

    try {
      await expect(
        uploadAttachment(access, {
          contractId,
          kind: "appendix",
          file: pdfFile("拒绝.pdf", "%PDF-1.7\nrejected"),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      await expect(requireEditableContract(access, contractId)).rejects.toMatchObject(
        { code: "CONFLICT" },
      );
      await expect(deleteAttachment(access, created.id)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    } finally {
      await prisma.contract.update({
        where: { id: contractId },
        data: { status: "draft" },
      });
    }
  });

  it("keeps a rejected contract editable so the initiator can resubmit", async () => {
    const access = await getAccessContext(employeeId);
    await prisma.contract.update({
      where: { id: contractId },
      data: { status: "rejected", stage: "returned" },
    });

    try {
      await expect(requireEditableContract(access, contractId)).resolves.toMatchObject({
        status: "rejected",
      });
      const uploaded = await uploadAttachment(access, {
        contractId,
        kind: "appendix",
        file: pdfFile("驳回后补充.pdf", "%PDF-1.7\nafter-reject"),
      });
      expect(uploaded.name).toBe("驳回后补充.pdf");
      await expect(deleteAttachment(access, uploaded.id)).resolves.toMatchObject({
        id: uploaded.id,
      });
    } finally {
      await prisma.contract.update({
        where: { id: contractId },
        data: { status: "draft", stage: "normal" },
      });
    }
  });

  it("soft deletes attachments and hides them from downloads", async () => {
    const access = await getAccessContext(employeeId);
    const created = await uploadAttachment(access, {
      contractId,
      kind: "appendix",
      file: pdfFile("待删除.pdf", "%PDF-1.7\ndelete"),
    });

    await deleteAttachment(access, created.id);
    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.deletedAt).not.toBeNull();
    await expect(
      getAttachmentForDownload(employeeId, created.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
