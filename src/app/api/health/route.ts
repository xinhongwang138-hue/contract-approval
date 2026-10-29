import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { logger } from "@/server/logger";

export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      db: "up",
      time: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ err: error }, "health check failed");
    return NextResponse.json(
      { ok: false, db: "down", time: new Date().toISOString() },
      { status: 503 },
    );
  }
}
