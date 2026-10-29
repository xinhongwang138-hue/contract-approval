import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebhookDispatcher } from "@/server/flow/webhook";

type FetchCall = { url: string; init: RequestInit };

function stubFetch(response: { ok: boolean; status: number }): (input: string, init: RequestInit) => Promise<Response> {
  return async (input, init) => {
    calls.push({ url: input, init });
    return {
      ok: response.ok,
      status: response.status,
    } as Response;
  };
}

let calls: FetchCall[] = [];
const originalAllowList = process.env.WEBHOOK_ALLOWED_HOSTS;

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  if (originalAllowList === undefined) {
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
  } else {
    process.env.WEBHOOK_ALLOWED_HOSTS = originalAllowList;
  }
});

describe("webhook dispatcher", () => {
  it("refuses every target when no allow list is configured", async () => {
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
    const dispatcher = createWebhookDispatcher(stubFetch({ ok: true, status: 200 }) as never);
    await expect(dispatcher.post("https://hooks.example.com/x", {})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(calls).toHaveLength(0);
  });

  it("posts JSON only to allow-listed hosts", async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "hooks.internal";
    const dispatcher = createWebhookDispatcher(stubFetch({ ok: true, status: 204 }) as never);
    await dispatcher.post("https://hooks.internal/contract", { contractId: "c-1" });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://hooks.internal/contract");
    expect(call?.init.method).toBe("POST");
    expect((call?.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(call?.init.body).toContain("c-1");
  });

  it("supports wildcard host entries", async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "*.example.com";
    const dispatcher = createWebhookDispatcher(stubFetch({ ok: true, status: 200 }) as never);
    await expect(dispatcher.post("https://api.example.com/hook", {})).resolves.toBeUndefined();
    await expect(
      dispatcher.post("https://evil.com/hook", {}),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects non-http protocols and malformed targets", async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "hooks.internal";
    const dispatcher = createWebhookDispatcher(stubFetch({ ok: true, status: 200 }) as never);
    await expect(dispatcher.post("file:///etc/passwd", {})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(dispatcher.post("not-a-url", {})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("turns a non-2xx response into an internal error so the flow transaction fails", async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "hooks.internal";
    const dispatcher = createWebhookDispatcher(stubFetch({ ok: false, status: 500 }) as never);
    await expect(dispatcher.post("https://hooks.internal/x", {})).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  it("wraps network failures", async () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "hooks.internal";
    const failing = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    const dispatcher = createWebhookDispatcher(failing as never);
    await expect(dispatcher.post("https://hooks.internal/x", {})).rejects.toMatchObject({
      code: "INTERNAL",
      message: expect.stringContaining("ETIMEDOUT"),
    });
  });
});
