import { describe, expect, it } from "vitest";
import {
  contractDraftSchema,
  contractListQuerySchema,
  contractUpdateSchema,
} from "@/shared/schemas/contract";
import {
  ATTACHMENT_MAX_BYTES,
  getFileExtension,
  sanitizeFileName,
} from "@/shared/schemas/attachment";

const validDraft = {
  templateId: "tpl_1",
  typeId: "type_1",
  title: "年度采购框架协议",
  partyAId: "party_a",
  partyBId: "party_b",
  amount: "500000.50",
  currency: "cny",
  signDate: "2026-11-01",
  startDate: "2026-11-01",
  endDate: "2027-10-31",
  formData: { contact: "张三" },
  bodyMarkdown: "# 合同正文",
};

describe("contractDraftSchema", () => {
  it("normalizes currency and keeps money as string", () => {
    const parsed = contractDraftSchema.parse(validDraft);
    expect(parsed.currency).toBe("CNY");
    expect(parsed.amount).toBe("500000.50");
  });

  it("applies defaults", () => {
    const parsed = contractDraftSchema.parse({
      ...validDraft,
      currency: undefined,
      formData: undefined,
      bodyMarkdown: undefined,
    });
    expect(parsed.currency).toBe("CNY");
    expect(parsed.formData).toEqual({});
    expect(parsed.bodyMarkdown).toBe("");
  });

  it("rejects invalid amounts", () => {
    for (const amount of ["0", "0.00", "1.234", "-5", "abc", ""]) {
      expect(contractDraftSchema.safeParse({ ...validDraft, amount }).success).toBe(
        false,
      );
    }
  });

  it("rejects endDate before startDate", () => {
    const result = contractDraftSchema.safeParse({
      ...validDraft,
      endDate: "2026-10-31",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["endDate"]);
  });

  it("rejects identical parties", () => {
    const result = contractDraftSchema.safeParse({
      ...validDraft,
      partyBId: "party_a",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["partyBId"]);
  });

  it("update schema requires id", () => {
    expect(contractUpdateSchema.safeParse(validDraft).success).toBe(false);
    expect(
      contractUpdateSchema.safeParse({ ...validDraft, id: "c1" }).success,
    ).toBe(true);
  });
});

describe("contractListQuerySchema", () => {
  it("applies paging defaults", () => {
    const parsed = contractListQuerySchema.parse({});
    expect(parsed).toEqual({
      page: 1,
      pageSize: 20,
      sort: "updatedAt",
      order: "desc",
    });
  });

  it("coerces query strings and rejects unknown sort", () => {
    const parsed = contractListQuerySchema.parse({
      q: "采购",
      status: "draft",
      page: "2",
      pageSize: "50",
      sort: "amount",
      order: "asc",
    });
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.status).toBe("draft");

    expect(
      contractListQuerySchema.safeParse({ sort: "no; DROP TABLE" }).success,
    ).toBe(false);
    expect(
      contractListQuerySchema.safeParse({ status: "hacked" }).success,
    ).toBe(false);
  });
});

describe("attachment helpers", () => {
  it("extracts extension", () => {
    expect(getFileExtension("合同.PDF")).toBe("pdf");
    expect(getFileExtension("archive.tar.gz")).toBe("gz");
    expect(getFileExtension("noext")).toBeNull();
    expect(getFileExtension(".hidden")).toBeNull();
  });

  it("sanitizes paths and control characters", () => {
    expect(sanitizeFileName("..\\..\\etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName("a\u0000b<>?.docx")).toBe("ab.docx");
    expect(sanitizeFileName("   ")).toBe("attachment");
  });

  it("limits uploads to 20MB", () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});
