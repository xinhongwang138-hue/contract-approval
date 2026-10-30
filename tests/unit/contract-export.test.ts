import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import {
  exportMaxRows,
  neutralizeCell,
  safeSheetName,
  toCsv,
  toXlsx,
} from "@/server/services/contract-export";

const BOM = String.fromCharCode(0xfeff);

function readZip(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, dataStart).toString("utf8");
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? raw.toString("utf8") : inflateRawSync(raw).toString("utf8"));
    offset = dataStart + compressedSize;
  }
  return entries;
}

describe("csv ledger export", () => {
  it("prefixes the BOM and separates rows with CRLF", () => {
    const csv = toCsv(["编号", "标题"], [["HT-1", "甲乙合同"]]);
    expect(csv).toBe(`${BOM}编号,标题\r\nHT-1,甲乙合同\r\n`);
  });

  it("quotes cells containing separators and doubles inner quotes", () => {
    const csv = toCsv(["标题"], [['他说"好,再等等"']]);
    // 整体加引号，内部每个 " 变成 ""，所以结尾是「转义引号 + 收尾引号」三个引号
    expect(csv).toBe(`${BOM}标题\r\n"他说""好,再等等"""\r\n`);
  });

  it("neutralises formula injection", () => {
    expect(neutralizeCell('=HYPERLINK("http://evil")')).toBe(
      '\'=HYPERLINK("http://evil")',
    );
    expect(neutralizeCell("@SUM(1,2)")).toBe("'@SUM(1,2)");
    expect(neutralizeCell("-1+1")).toBe("'-1+1");
    expect(neutralizeCell("正常标题")).toBe("正常标题");

    const csv = toCsv(["标题"], [["=cmd|'/C calc'!A0"]]);
    expect(csv).toBe(`${BOM}标题\r\n'=cmd|'/C calc'!A0\r\n`);
  });

  it("keeps numbers unquoted and empty cells blank", () => {
    expect(toCsv(["金额", "备注"], [[180000.5, null]])).toBe(
      `${BOM}金额,备注\r\n180000.5,\r\n`,
    );
  });

  it("caps the row budget defensively", () => {
    expect(exportMaxRows(undefined)).toBe(10000);
    expect(exportMaxRows("500")).toBe(500);
    expect(exportMaxRows("0")).toBe(10000);
    expect(exportMaxRows("abc")).toBe(10000);
    expect(exportMaxRows("99999999")).toBe(10000);
  });
});

describe("xlsx ledger export", () => {
  const ledger = {
    columns: ["编号", "标题", "金额"],
    rows: [
      ["HT-1", "甲 & 乙 <合同>", 180000.5],
      ["HT-2", "", null],
    ],
    fileName: "合同台账-2026-10-30",
  };

  it("writes a readable workbook with inline strings", () => {
    const zip = readZip(toXlsx(ledger));
    expect([...zip.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);

    const sheet = zip.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('<t xml:space="preserve">编号</t>');
    expect(sheet).toContain("甲 &amp; 乙 &lt;合同&gt;");
    expect(sheet).toContain('<c r="C2"><v>180000.5</v></c>');
    expect(sheet).toContain('<row r="3">');
    // 空单元格不写出，避免多出一堆空 <c>
    expect(sheet).not.toContain('<c r="B3"');

    expect(zip.get("xl/workbook.xml")).toContain('name="合同台账-2026-10-30"');
  });

  it("starts with the zip signature", () => {
    expect(toXlsx(ledger).readUInt32LE(0)).toBe(0x04034b50);
  });

  it("sanitises sheet names to what Excel accepts", () => {
    expect(safeSheetName("台账[1]:2*3?4/5\\6")).toBe("台账123456");
    expect(safeSheetName("   ")).toBe("Sheet1");
    expect(safeSheetName("x".repeat(50))).toHaveLength(31);
  });
});
