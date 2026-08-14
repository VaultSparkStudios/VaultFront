import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthHeader } = vi.hoisted(() => ({ getAuthHeader: vi.fn() }));

vi.mock("../../src/client/Auth", () => ({ getAuthHeader }));
vi.mock("../../src/client/Api", () => ({ getApiBase: () => "/api" }));

import { createSupporterCheckoutSession } from "../../src/client/SupporterApi";

describe("supporter checkout client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getAuthHeader.mockResolvedValue("Bearer actor-token");
  });

  it("posts the fixed offer with a retry-stable request identifier", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_123" }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    await expect(createSupporterCheckoutSession()).resolves.toBe(
      "https://checkout.stripe.com/c/pay/cs_123",
    );
    const [, init] = request.mock.calls[0];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer actor-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      offerId: "supporter-500",
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    });
  });

  it("fails closed before network access without authenticated authority", async () => {
    getAuthHeader.mockResolvedValue(null);
    const request = vi.spyOn(globalThis, "fetch");
    await expect(createSupporterCheckoutSession()).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
