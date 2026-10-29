import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "contract-approval" },
  redact: {
    paths: ["password", "*.password", "req.headers.authorization", "req.headers.cookie"],
    censor: "[redacted]",
  },
});
