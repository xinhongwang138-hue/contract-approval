import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** 真正的鉴权入口：拿到调用者身份，并校验权限或数据范围 */
const REAL_GUARDS =
  /requirePermission\s*\(|requireContractAccess\s*\(|getAccessContext\s*\(|requireAuth\s*\(/;

/** 顶层函数声明（导出与否都算），用于把文件切成函数体 */
const FUNCTION_HEADER = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;

/** 设计上不需要守卫：登录前本就没有会话，健康检查在 proxy 白名单里 */
const PUBLIC_ENTRIES = new Set([
  "src/server/actions/auth.ts",
  "src/app/api/health/route.ts",
]);

/** 整行注释先抹掉，否则被注释掉的 requireAuth() 会让扫描器误判为已守卫 */
function withoutLineComments(code: string): string {
  return code.replace(/^\s*\/\/.*$/gm, "");
}

function entryFiles(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir)) {
    const full = path.join(dir, item);
    if (statSync(full).isDirectory()) {
      out.push(...entryFiles(full, match));
    } else if (match(item)) {
      out.push(path.relative(process.cwd(), full).replace(/\\/g, "/"));
    }
  }
  return out;
}

function readEntry(file: string): string {
  return withoutLineComments(readFileSync(file, "utf8"));
}

function functionsOf(code: string): Map<string, string> {
  const headers = [...code.matchAll(FUNCTION_HEADER)];
  const map = new Map<string, string>();
  headers.forEach((header, index) => {
    const start = header.index + header[0].length;
    const next = headers[index + 1];
    map.set(header[1] as string, code.slice(start, next ? next.index : code.length));
  });
  return map;
}

/**
 * 动作层允许把鉴权收在本地 require* helper 里（users.ts 就是这么写的），
 * 所以这里做传递闭包：调用了「最终会落到真实守卫」的函数，也算有守卫。
 */
function guardedFunctions(code: string): Set<string> {
  const functions = functionsOf(code);
  const guarded = new Set<string>();
  for (let pass = 0; pass < functions.size + 1; pass += 1) {
    let changed = false;
    for (const [name, body] of functions) {
      if (guarded.has(name) || REAL_GUARDS.test(body)) {
        if (!guarded.has(name)) {
          guarded.add(name);
          changed = true;
        }
        continue;
      }
      for (const other of guarded) {
        if (other !== name && new RegExp(`\\b${other}\\s*\\(`).test(body)) {
          guarded.add(name);
          changed = true;
          break;
        }
      }
    }
    if (!changed) {
      break;
    }
  }
  return guarded;
}

function exportedEntries(file: string): { name: string; guarded: boolean }[] {
  const code = readEntry(file);
  const guarded = guardedFunctions(code);
  return [...functionsOf(code).keys()]
    .filter((name) => new RegExp(`^export\\s+(?:async\\s+)?function\\s+${name}\\b`, "m").test(code))
    .map((name) => ({ name, guarded: guarded.has(name) }));
}

const files = [
  ...entryFiles(path.join(process.cwd(), "src/server/actions"), (n) => n.endsWith(".ts")),
  ...entryFiles(path.join(process.cwd(), "src/app/api"), (n) => n === "route.ts"),
]
  // 只认真正声明了 "use server" 的动作文件；helpers.ts 这类纯工具模块自动排除在外
  .filter((f) => f.endsWith("route.ts") || /^"use server";?\s*$/m.test(readEntry(f)))
  .filter((f) => !PUBLIC_ENTRIES.has(f));

const entries = files.flatMap((file) =>
  exportedEntries(file).map((entry) => ({ ...entry, file })),
);

describe("server entry authorization guards", () => {
  it("scans every server action and api route", () => {
    // 扫描器一旦失效（导出写法变了、目录改名了），用例不能静默变成空跑
    expect(files.length).toBeGreaterThanOrEqual(14);
    expect(entries.length).toBeGreaterThanOrEqual(30);
  });

  it("resolves the caller in every server entry before doing work", () => {
    const offenders = entries
      .filter((entry) => !entry.guarded)
      .map((entry) => `${entry.file}#${entry.name}`);
    expect(offenders).toEqual([]);
  });
});
