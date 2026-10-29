import "dotenv/config";

import { prisma } from "../src/server/db/client";
import { processDueTasks } from "../src/server/flow/engine";
import { logger } from "../src/server/logger";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 5 * 60 * 1000);
const BATCH_LIMIT = Number(process.env.WORKER_BATCH_LIMIT ?? 200);

let stopping = false;
let wakeUp: (() => void) | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wakeUp = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function stop(signal: string): void {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info({ signal }, "flow timeout worker stopping");
  wakeUp?.();
}

async function tick(): Promise<void> {
  const startedAt = Date.now();
  const result = await prisma.$transaction((tx) =>
    processDueTasks(tx, { now: new Date(), limit: BATCH_LIMIT }),
  );
  logger.info(
    { ...result, durationMs: Date.now() - startedAt },
    "flow timeout sweep finished",
  );
}

async function main(): Promise<void> {
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  logger.info({ intervalMs: INTERVAL_MS, batchLimit: BATCH_LIMIT }, "flow timeout worker started");

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      logger.error({ err: error }, "flow timeout sweep failed");
    }
    if (stopping) {
      break;
    }
    await sleep(INTERVAL_MS);
  }

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  logger.error({ err: error }, "flow timeout worker crashed");
  await prisma.$disconnect();
  process.exit(1);
});
