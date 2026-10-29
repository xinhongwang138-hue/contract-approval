import { AppError, ERROR_CODES, ValidationError } from "@/shared/errors";
import type { WebhookDispatcher } from "./types";

const REQUEST_TIMEOUT_MS = 5000;

function allowedHosts(): string[] {
  return (process.env.WEBHOOK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
}

function assertAllowedTarget(target: string): URL {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new ValidationError("webhook 目标必须是完整的 http(s) 地址");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError("webhook 目标只允许 http(s) 协议");
  }
  const hosts = allowedHosts();
  if (hosts.length === 0) {
    throw new ValidationError(
      "未配置 WEBHOOK_ALLOWED_HOSTS，出于 SSRF 防护拒绝发起外部回调",
    );
  }
  const host = url.hostname.toLowerCase();
  const allowed = hosts.some((entry) => entry === host || (entry.startsWith("*.") && host.endsWith(entry.slice(1))));
  if (!allowed) {
    throw new ValidationError(`webhook 目标 ${host} 不在 WEBHOOK_ALLOWED_HOSTS 白名单内`);
  }
  return url;
}

export function createWebhookDispatcher(
  fetchImpl: typeof fetch = fetch,
): WebhookDispatcher {
  return {
    async post(target, payload) {
      const url = assertAllowedTarget(target);
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new AppError(
          ERROR_CODES.INTERNAL,
          `webhook 调用失败：${(error as Error).message}`,
        );
      }
      if (!response.ok) {
        throw new AppError(
          ERROR_CODES.INTERNAL,
          `webhook 返回非 2xx 状态：${response.status}`,
        );
      }
    },
  };
}
