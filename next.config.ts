import type { NextConfig } from "next";

// 构建并行度：内存紧张的机器（或 CI 小实例）可用 NEXT_BUILD_WORKERS=2 压低 worker 数，
// 否则每个 worker 各自一份 V8 堆，容易在静态页生成阶段 OOM。
const buildWorkers = Number(process.env.NEXT_BUILD_WORKERS ?? "0");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
    ...(buildWorkers > 0 ? { cpus: buildWorkers } : {}),
  },
  serverExternalPackages: ["@node-rs/argon2", "pino", "pg"],
};

export default nextConfig;
