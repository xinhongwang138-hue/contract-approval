import { deflateRawSync } from "node:zlib";
import type { AccessContext } from "@/server/auth/access";
import { prisma } from "@/server/db/client";
import {
  buildContractListOrderBy,
  buildContractListWhere,
} from "@/server/services/contract";
import { AppError, ERROR_CODES } from "@/shared/errors";
import { CONTRACT_STATUS_LABELS } from "@/shared/contract-status";
import { dateOnly } from "@/server/services/approval";
import type { ContractListQuery, ContractSortField } from "@/shared/schemas/contract";

const CSV_BOM = String.fromCharCode(0xfeff);
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export type ExportCell = string | number | null;

export type Ledger = {
  columns: string[];
  rows: ExportCell[][];
  fileName: string;
};

export function exportMaxRows(raw: string | undefined): number {
  const value = Number(raw ?? 10000);
  return Number.isInteger(value) && value >= 1 && value <= 100000 ? value : 10000;
}

export async function getContractLedger(
  access: AccessContext,
  query: {
    q?: string;
    status?: ContractListQuery["status"];
    sort: ContractSortField;
    order: "asc" | "desc";
  },
  maxRows: number,
): Promise<Ledger> {
  if (!access.permissions.has("contract.export")) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "没有导出合同台账的权限");
  }
  if (!access.permissions.has("contract.read")) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "没有查看合同的权限");
  }

  const where = await buildContractListWhere(access, { q: query.q, status: query.status });
  const rows = await prisma.contract.findMany({
    where,
    orderBy: buildContractListOrderBy(query.sort, query.order),
    take: maxRows + 1,
    select: {
      no: true,
      title: true,
      status: true,
      amount: true,
      currency: true,
      signDate: true,
      startDate: true,
      endDate: true,
      partyA: { select: { name: true } },
      partyB: { select: { name: true } },
      template: { select: { name: true, code: true } },
      creator: { select: { name: true } },
      ownerDepartment: { select: { name: true } },
      updatedAt: true,
    },
  });

  if (rows.length > maxRows) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      `台账共 ${rows.length} 条以上，超过单次导出上限 ${maxRows} 条，请按状态或关键字缩小范围`,
    );
  }

  return {
    columns: [
      "合同编号",
      "合同标题",
      "状态",
      "金额",
      "币种",
      "签署日期",
      "开始日期",
      "结束日期",
      "甲方",
      "乙方",
      "模板",
      "发起人",
      "归属部门",
      "最近更新",
    ],
    rows: rows.map((row) => [
      row.no,
      row.title,
      CONTRACT_STATUS_LABELS[row.status] ?? row.status,
      Number(row.amount.toFixed(2)),
      row.currency,
      dateOnly(row.signDate),
      dateOnly(row.startDate),
      dateOnly(row.endDate),
      row.partyA.name,
      row.partyB.name,
      `${row.template.name}（${row.template.code}）`,
      row.creator.name,
      row.ownerDepartment?.name ?? "",
      dateOnly(row.updatedAt),
    ]),
    fileName: `合同台账-${new Date().toISOString().slice(0, 10)}`,
  };
}

/** CSV 公式注入防护：以 = + - @ 或制表符开头的文本会被 Excel 当公式执行。 */
export function neutralizeCell(value: string): string {
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;
}

export function toCsvCell(value: ExportCell): string {
  if (value === null) {
    return "";
  }
  const text = typeof value === "number" ? String(value) : neutralizeCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(columns: string[], rows: ExportCell[][]): string {
  const lines = [columns, ...rows].map((row) => row.map(toCsvCell).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function columnName(index: number): string {
  let name = "";
  let cursor = index + 1;
  while (cursor > 0) {
    cursor -= 1;
    name = String.fromCharCode(65 + (cursor % 26)) + name;
    cursor = Math.floor(cursor / 26);
  }
  return name;
}

function sheetXml(columns: string[], rows: ExportCell[][]): string {
  const cell = (ref: string, value: ExportCell): string => {
    if (value === null || value === "") {
      return "";
    }
    if (typeof value === "number") {
      return `<c r="${ref}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  };

  const body = [columns, ...rows].map((row, rowIndex) => {
    const cells = row
      .map((value, columnIndex) => cell(`${columnName(columnIndex)}${rowIndex + 1}`, value))
      .join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body.join("")}</sheetData></worksheet>`;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

type ZipEntry = { name: string; data: Buffer };

function dosTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zipEntries(entries: ZipEntry[], now: Date): Buffer {
  const { time, date } = dosTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralStart = offset;
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, end]);
}

export function safeSheetName(value: string): string {
  const cleaned = value.replaceAll(/[[\]:*?/\\]/g, "").trim();
  return cleaned === "" ? "Sheet1" : cleaned.slice(0, 31);
}

export function toXlsx(ledger: Ledger, now: Date = new Date()): Buffer {
  const sheetName = safeSheetName(ledger.fileName);
  const parts: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
        "utf8",
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
        "utf8",
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
          ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
          `</workbook>`,
        "utf8",
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
        "utf8",
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: Buffer.from(sheetXml(ledger.columns, ledger.rows), "utf8"),
    },
  ];

  return zipEntries(parts, now);
}
