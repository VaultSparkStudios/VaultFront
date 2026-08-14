import express from "express";
import { createHmac } from "node:crypto";
import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createSupporterCheckout,
  installStripeSupportBodyParsers,
  loadRevenueObservation,
  recordStripeEvent,
  registerStripeSupportRoutes,
  verifyStripeWebhookSignature,
} from "../../src/server/StripeSupport";

describe("Stripe supporter authority", () => {
  it("verifies fresh Stripe signatures and rejects stale or tampered bodies", () => {
    const body = Buffer.from('{"id":"evt_1"}');
    const secret = "whsec_test";
    const timestamp = 1_700_000_000;
    const digest = createHmac("sha256", secret)
      .update(`${timestamp}.${body.toString("utf8")}`)
      .digest("hex");
    const header = `t=${timestamp},v1=${digest}`;
    expect(verifyStripeWebhookSignature(body, header, secret, timestamp)).toBe(
      true,
    );
    expect(
      verifyStripeWebhookSignature(
        Buffer.from("{}"),
        header,
        secret,
        timestamp,
      ),
    ).toBe(false);
    expect(
      verifyStripeWebhookSignature(body, header, secret, timestamp + 301),
    ).toBe(false);
  });

  it("creates only the server-owned fixed supporter offer", async () => {
    const request = vi.fn(async (_url, init) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("line_items[0][price_data][unit_amount]")).toBe("500");
      expect(
        (init?.headers as Record<string, string>)["idempotency-key"],
      ).toMatch(/^vaultfront-support-[0-9a-f]{64}$/u);
      expect(body.get("success_url")).toContain(
        "https://staging.vaultfront.io/",
      );
      return new Response(
        JSON.stringify({
          id: "cs_123",
          url: "https://checkout.stripe.com/c/pay/cs_123",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    await expect(
      createSupporterCheckout(
        {
          actorHash: "actor",
          origin: "https://staging.vaultfront.io",
          requestId: "f98432d0-7d9e-4da8-89f0-d6066cb7cf48",
          secretKey: "sk_test",
        },
        request,
      ),
    ).resolves.toEqual({
      id: "cs_123",
      url: "https://checkout.stripe.com/c/pay/cs_123",
    });
  });

  it("persists one idempotent positive checkout receipt", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const result = await recordStripeEvent({ query } as any, {
      id: "evt_live",
      type: "checkout.session.completed",
      created: 1_700_000_000,
      livemode: true,
      data: {
        object: {
          id: "cs_live",
          payment_status: "paid",
          amount_total: 500,
          currency: "usd",
          metadata: { project: "vaultfront" },
        },
      },
    });
    expect(result).toMatchObject({ accepted: true, duplicate: false });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("does not persist unpaid or foreign-project events", async () => {
    const query = vi.fn();
    const result = await recordStripeEvent({ query } as any, {
      type: "checkout.session.completed",
      data: { object: { payment_status: "unpaid" } },
    });
    expect(result).toEqual({
      accepted: false,
      reason: "non-positive-checkout-event",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("projects only a durable live positive receipt into canonical revenue", async () => {
    const database = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            amount_cents: 500,
            observed_at: new Date("2026-08-14T05:00:00.000Z"),
            receipt_digest: `sha256:${"a".repeat(64)}`,
          },
        ],
      }),
    };
    const observation = await loadRevenueObservation(database as any);
    expect(observation).toMatchObject({
      status: "verified",
      live: true,
      eventType: "supporter",
      amountCents: 500,
    });
    expect(observation?.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("parses checkout JSON only on the owned route", async () => {
    const app = express();
    installStripeSupportBodyParsers(app);
    app.post("/stripe/create-checkout-session", (req, res) =>
      res.status(200).json(req.body),
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(
        `http://127.0.0.1:${port}/stripe/create-checkout-session`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            offerId: "supporter-500",
            requestId: "f98432d0-7d9e-4da8-89f0-d6066cb7cf48",
          }),
        },
      );
      expect(await response.json()).toMatchObject({
        offerId: "supporter-500",
        requestId: "f98432d0-7d9e-4da8-89f0-d6066cb7cf48",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("preserves the raw webhook body ahead of the default JSON parser", async () => {
    const app = express();
    const secret = "whsec_route_test";
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    installStripeSupportBodyParsers(app);
    registerStripeSupportRoutes(app, {
      pool: () => ({ query }) as any,
      reportError: (error) => {
        throw error;
      },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const body = JSON.stringify({
        id: "evt_route",
        type: "checkout.session.completed",
        created: Math.floor(Date.now() / 1_000),
        livemode: true,
        data: {
          object: {
            id: "cs_route",
            payment_status: "paid",
            amount_total: 500,
            currency: "usd",
            metadata: { project: "vaultfront" },
          },
        },
      });
      const timestamp = Math.floor(Date.now() / 1_000);
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/stripe/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        body,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true, accepted: true });
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (original === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = original;
    }
  });
});
