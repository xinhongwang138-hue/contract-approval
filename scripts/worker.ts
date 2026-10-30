import "dotenv/config";

import { prisma } from "../src/server/db/client";
import { processDueTasks } from "../src/server/flow/engine";
import { processContractExpiry } from "../src/server/services/lifecycle";
import { logger } from "../src/server/logger";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 5 * 60 * 1000);
const BATCH_LIMIT = Number(process.env.WORKER_BATCH_LIMIT ?? 200);
const EXPIRY_WARNING_DAYS = process.env.CONTRACT_EXPIRY_WARNING_DAYS ?? "30,7";

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
  const now = new Date();
  const result = await prisma.$transaction((tx) =>
    processDueTasks(tx, { now, limit: BATCH_LIMIT }),
  );
  const expiry = await prisma.$transaction((tx) =>
    processContractExpiry(tx, { now, warningDays: EXPIRY_WARNING_DAYS, limit: BATCH_LIMIT }),
  );
  logger.info(
    { ...result, ...expiry, durationMs: Date.now() - startedAt },
    "worker sweep finished",
  );
}

async function main(): Promise<void> {
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  logger.info(
    { intervalMs: INTERVAL_MS, batchLimit: BATCH_LIMIT, expiryWarningDays: EXPIRY_WARNING_DAYS },
    "contract worker started",
  );

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      logger.error({ err: error }, "worker sweep failed");
    }
    if (stopping) {
      break;
    }
    await sleep(INTERVAL_MS);
  }

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  logger.error({ err: error }, "worker crashed");
  await prisma.$disconnect();
  process.exit(1);
});
