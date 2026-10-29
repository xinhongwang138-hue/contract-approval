import { stat } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  deleteStoredFile,
  getStorageDir,
  openStoredFile,
  saveStoredFile,
} from "@/server/storage/local-storage";

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

const savedKeys: string[] = [];

afterAll(async () => {
  for (const key of savedKeys) {
    await deleteStoredFile(key);
  }
});

describe("local storage", () => {
  it("writes with a random uuid key and reads the same bytes", async () => {
    const content = Buffer.from("%PDF-1.7 test");
    const first = await saveStoredFile(content, "pdf");
    const second = await saveStoredFile(content, "pdf");
    savedKeys.push(first.storageKey, second.storageKey);

    expect(first.storageKey).not.toBe(second.storageKey);
    expect(first.storageKey).toMatch(/\.pdf$/);
    expect(first.sha256).toHaveLength(64);
    expect(first.sha256).toBe(second.sha256);
    expect(first.size).toBe(content.byteLength);

    const stored = await stat(`${getStorageDir()}/${first.storageKey}`);
    expect(stored.size).toBe(content.byteLength);

    const readBack = await streamToBuffer(openStoredFile(first.storageKey));
    expect(readBack.equals(content)).toBe(true);
  });

  it("refuses path traversal storage keys", () => {
    expect(() => openStoredFile("../../etc/passwd")).toThrow("无效的存储键");
    expect(() => openStoredFile("not-a-key.pdf")).toThrow("无效的存储键");
  });

  it("rejects invalid extensions when saving", async () => {
    await expect(saveStoredFile(Buffer.from("x"), "../pdf")).rejects.toThrow(
      "无效的文件扩展名",
    );
  });
});
