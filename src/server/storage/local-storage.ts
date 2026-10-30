import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/;

export function getStorageDir(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.STORAGE_DIR ??
      path.join(process.cwd(), "storage"),
  );
}

function storagePath(storageKey: string): string {
  // 附件是运行时数据，不参与构建产物追踪。
  return path.join(/* turbopackIgnore: true */ getStorageDir(), storageKey);
}

export async function saveStoredFile(
  buffer: Buffer,
  extension: string,
): Promise<{ storageKey: string; sha256: string; size: number }> {
  if (!/^[a-z0-9]{1,10}$/.test(extension)) {
    throw new Error("无效的文件扩展名");
  }
  await mkdir(getStorageDir(), { recursive: true });
  const storageKey = `${randomUUID()}.${extension}`;
  await writeFile(storagePath(storageKey), buffer);
  return {
    storageKey,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    size: buffer.byteLength,
  };
}

export function openStoredFile(storageKey: string): ReadStream {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error("无效的存储键");
  }
  return createReadStream(storagePath(storageKey));
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    return;
  }
  try {
    await unlink(storagePath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
