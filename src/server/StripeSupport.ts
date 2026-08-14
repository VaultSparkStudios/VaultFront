import type { Application, Request, Response } from "express";
import express from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { buildCanonicalReleaseObservation } from "../shared/ReleaseGateCatalog";
import {
  deriveObeliskPersistentId,
  readObeliskConfig,
  verifyObeliskAccessToken,
} from "./ObeliskAuth";
import type { ReleaseGateObservation } from "./ReleaseEvidenceContract";

const CHECKOUT_OFFER = {
  id: "supporter-500",
  amountCents: 500,
  currency: "usd",
  productName: "VaultFront Supporter Signal",
} as const;
const signatureToleranceSeconds = 5 * 60;
const checkoutSchema = z
  .object({
    offerId: z.literal(CHECKOUT_OFFER.id),
    requestId: z.string().uuid(),
  })
  .strict();

type Queryable = Pick<Pool, "query">;

export function verifyStripeWebhookSignature(
  body: Buffer,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  const fields = header.split(",").map((part) => part.split("=", 2));
  const timestamp = Number(fields.find(([key]) => key === "t")?.[1]);
  const candidates = fields
    .filter(([key]) => key === "v1")
    .map(([, value]) => value)
    .filter((value): value is string => /^[0-9a-f]{64}$/u.test(value ?? ""));
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > signatureToleranceSeconds ||
    candidates.length === 0
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest();
  return candidates.some((candidate) => {
    const supplied = Buffer.from(candidate, "hex");
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  });
}

function configuredOrigin(environment: NodeJS.ProcessEnv): string | null {
  const domain = environment.DOMAIN?.trim();
  const subdomain = environment.SUBDOMAIN?.trim();
  if (!domain || !subdomain) return null;
  return subdomain === "main"
    ? `https://${domain}`
    : `https://${subdomain}.${domain}`;
}

async function authenticatedActorHash(req: Request): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const verified = await verifyObeliskAccessToken(header.slice(7));
  const config = readObeliskConfig();
  if (verified.type !== "success" || !config) return null;
  const persistentId = deriveObeliskPersistentId(config.issuer, verified.sub);
  return createHash("sha256")
    .update(`vaultfront:stripe-actor:v1:${persistentId}`)
    .digest("hex");
}

export async function createSupporterCheckout(
  input: {
    actorHash: string;
    origin: string;
    requestId: string;
    secretKey: string;
  },
  request: typeof fetch = fetch,
): Promise<{ id: string; url: string }> {
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": CHECKOUT_OFFER.currency,
    "line_items[0][price_data][unit_amount]": String(
      CHECKOUT_OFFER.amountCents,
    ),
    "line_items[0][price_data][product_data][name]": CHECKOUT_OFFER.productName,
    "line_items[0][quantity]": "1",
    success_url: `${input.origin}/?support=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/?support=cancelled`,
    "metadata[project]": "vaultfront",
    "metadata[actor_hash]": input.actorHash,
  });
  const response = await request(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": `vaultfront-support-${createHash("sha256")
          .update(`${input.actorHash}:${input.requestId}`)
          .digest("hex")}`,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    },
  );
  const result = (await response.json().catch(() => null)) as {
    id?: string;
    url?: string;
  } | null;
  if (!response.ok || !result?.id || !result.url)
    throw new Error(`Stripe checkout creation failed (${response.status})`);
  const checkoutUrl = new URL(result.url);
  if (
    checkoutUrl.protocol !== "https:" ||
    checkoutUrl.hostname !== "checkout.stripe.com"
  )
    throw new Error("Stripe returned an invalid checkout URL");
  return { id: result.id, url: result.url };
}

export async function recordStripeEvent(database: Queryable, event: any) {
  if (
    event?.type !== "checkout.session.completed" ||
    event?.data?.object?.payment_status !== "paid" ||
    event?.data?.object?.metadata?.project !== "vaultfront" ||
    !Number.isSafeInteger(event?.data?.object?.amount_total) ||
    event.data.object.amount_total <= 0
  )
    return { accepted: false, reason: "non-positive-checkout-event" } as const;
  const observedAt = new Date(Number(event.created) * 1_000).toISOString();
  const receiptDigest = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        eventId: event.id,
        sessionId: event.data.object.id,
        amountCents: event.data.object.amount_total,
        currency: event.data.object.currency,
        live: event.livemode === true,
        observedAt,
      }),
    )
    .digest("hex")}`;
  const result = await database.query(
    `INSERT INTO supporter_payment_receipts
       (event_id, session_id, amount_cents, currency, live_mode, observed_at, receipt_digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      event.id,
      event.data.object.id,
      event.data.object.amount_total,
      event.data.object.currency,
      event.livemode === true,
      observedAt,
      receiptDigest,
    ],
  );
  return {
    accepted: true,
    duplicate: result.rowCount === 0,
    receiptDigest,
  } as const;
}

export async function loadRevenueObservation(
  database: Queryable | null,
): Promise<ReleaseGateObservation | undefined> {
  if (!database) return undefined;
  const result = await database.query(
    `SELECT amount_cents, observed_at, receipt_digest
       FROM supporter_payment_receipts
      WHERE live_mode = TRUE AND amount_cents > 0
      ORDER BY observed_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return buildCanonicalReleaseObservation("revenueObservation", {
    status: "verified",
    observedAt: new Date(row.observed_at).toISOString(),
    source: `stripe-webhook:${row.receipt_digest}`,
    live: true,
    eventType: "supporter",
    amountCents: Number(row.amount_cents),
  }) as ReleaseGateObservation;
}

export function installStripeSupportBodyParsers(app: Application): void {
  app.use(
    "/stripe/webhook",
    express.raw({ type: "application/json", limit: "64kb" }),
  );
  app.use(
    "/stripe/create-checkout-session",
    express.json({ type: "application/json", limit: "4kb" }),
  );
}

export function registerStripeSupportRoutes(
  app: Application,
  options: {
    pool: () => Queryable | null;
    reportError: (error: unknown) => void;
  },
): void {
  app.post(
    "/stripe/create-checkout-session",
    async (req: Request, res: Response) => {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Invalid supporter offer" });
      const actorHash = await authenticatedActorHash(req);
      if (!actorHash)
        return res.status(401).json({ error: "Authentication required" });
      const origin = configuredOrigin(process.env);
      const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
      if (!origin || !secretKey)
        return res.status(503).json({ error: "Checkout unavailable" });
      try {
        return res.status(201).json(
          await createSupporterCheckout({
            actorHash,
            origin,
            requestId: parsed.data.requestId,
            secretKey,
          }),
        );
      } catch (error) {
        options.reportError(error);
        return res.status(502).json({ error: "Checkout unavailable" });
      }
    },
  );
  app.all("/stripe/create-checkout-session", (_req, res) =>
    res.status(405).json({ error: "Method not allowed" }),
  );

  app.post("/stripe/webhook", async (req: Request, res: Response) => {
    const database = options.pool();
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    const signature = req.headers["stripe-signature"];
    if (
      !database ||
      !secret ||
      !Buffer.isBuffer(req.body) ||
      typeof signature !== "string" ||
      !verifyStripeWebhookSignature(req.body, signature, secret)
    )
      return res.status(400).json({ error: "Invalid webhook" });
    try {
      const event = JSON.parse(req.body.toString("utf8"));
      const result = await recordStripeEvent(database, event);
      return res
        .status(200)
        .json({ received: true, accepted: result.accepted });
    } catch (error) {
      options.reportError(error);
      return res.status(503).json({ error: "Webhook persistence unavailable" });
    }
  });
}
