import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createRenderedHtmlDocument } from "../../src/server/RenderHtml";

function responseHarness() {
  const headers = new Map<string, string>();
  const send = vi.fn();
  return {
    response: {
      setHeader: (name: string, value: string) => headers.set(name, value),
      send,
    } as unknown as Response,
    headers,
    send,
  };
}

describe("rendered HTML document", () => {
  it("warms once and serves the same instance-bound shell without rereading", async () => {
    const load = vi.fn(async () => "<html>exact-instance</html>");
    const document = createRenderedHtmlDocument("/static/index.html", load);
    const first = responseHarness();
    const second = responseHarness();

    await Promise.all([document.warm(), document.warm()]);
    await document.send(first.response);
    await document.send(second.response);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith("/static/index.html");
    expect(first.send).toHaveBeenCalledWith("<html>exact-instance</html>");
    expect(second.send).toHaveBeenCalledWith("<html>exact-instance</html>");
    expect(first.headers.get("Cache-Control")).toContain("no-store");
    expect(first.headers.get("Content-Type")).toBe("text/html");
  });

  it("fails closed when the startup render cannot be loaded", async () => {
    const document = createRenderedHtmlDocument(
      "/missing/index.html",
      async () => Promise.reject(new Error("shell-unavailable")),
    );

    await expect(document.warm()).rejects.toThrow("shell-unavailable");
  });
});
