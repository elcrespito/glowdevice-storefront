import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/shopify
 *
 * Shopify `orders/paid` receiver. The draft-order flow stores Peptidemy's
 * internal order id/ref in note_attributes; after payment we forward a signed,
 * idempotent callback to Peptidemy.
 */
export async function POST(req: NextRequest) {
  // Shopify signs app webhooks with the app secret. Keep the dedicated env var
  // for explicit configuration, but fall back to SHOPIFY_CLIENT_SECRET so the
  // same Dev Dashboard app secret can be used without duplicating config.
  const shopifySecret =
    process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET || "";
  if (!shopifySecret) {
    console.error("[webhook] Shopify webhook secret not configured");
    return NextResponse.json(
      { error: "webhook_unconfigured" },
      { status: 503 },
    );
  }

  const body = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic");
  const shop = req.headers.get("x-shopify-shop-domain");
  const webhookId = req.headers.get("x-shopify-webhook-id") || "";

  if (!hmacHeader) {
    console.error("[webhook] missing x-shopify-hmac-sha256");
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }

  const expected = createHmac("sha256", shopifySecret)
    .update(body, "utf8")
    .digest("base64");
  const suppliedBuffer = Buffer.from(hmacHeader);
  const expectedBuffer = Buffer.from(expected);

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    console.error("[webhook] invalid Shopify signature");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let data: any;
  try {
    data = JSON.parse(body);
  } catch (err) {
    console.error("[webhook] invalid JSON", err);
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  console.info("[webhook] received", {
    webhookId,
    topic,
    shop,
    shopifyOrderId: data?.id,
  });

  try {
    switch (topic) {
      case "orders/paid":
        await handleOrderPaid(data, webhookId);
        break;
      case "draft_orders/update":
        handleDraftOrderUpdate(data);
        break;
      case "orders/create":
        handleOrderCreate(data);
        break;
      default:
        console.warn("[webhook] unhandled topic:", topic);
    }
  } catch (err) {
    // Returning non-2xx is intentional: Shopify should retry transient failures.
    console.error("[webhook] processing failed", { webhookId, topic, err });
    return NextResponse.json({ error: "processing_failed" }, { status: 502 });
  }

  return NextResponse.json({ received: true, webhookId: webhookId || undefined });
}

async function handleOrderPaid(order: any, webhookId: string) {
  const financialStatus = String(order?.financial_status || "").toLowerCase();
  if (financialStatus && financialStatus !== "paid") {
    console.warn("[webhook/orders/paid] unexpected financial status", {
      webhookId,
      shopifyOrderId: order?.id,
      financialStatus,
    });
    return;
  }

  const noteAttributes = Array.isArray(order?.note_attributes)
    ? order.note_attributes
    : [];
  const internalOrderId = noteAttributes.find(
    (attr: any) => attr?.name === "internal_order_id",
  )?.value;
  const internalRef = noteAttributes.find(
    (attr: any) => attr?.name === "internal_ref",
  )?.value;
  const returnUrl = noteAttributes.find(
    (attr: any) => attr?.name === "return_url",
  )?.value;

  console.info("[webhook/orders/paid]", {
    webhookId,
    shopifyOrderId: order?.id,
    orderNumber: order?.order_number || order?.name,
    internalOrderId,
    internalRef,
    totalPrice: order?.total_price,
    currency: order?.currency,
    financialStatus,
  });

  // Orders unrelated to the Peptidemy handoff should be acknowledged rather
  // than retried forever.
  if (!internalOrderId && !internalRef) {
    console.warn("[webhook/orders/paid] no Peptidemy correlation attributes", {
      webhookId,
      shopifyOrderId: order?.id,
    });
    return;
  }

  await notifyPeptidemy({
    internalOrderId: internalOrderId ? String(internalOrderId) : undefined,
    internalRef: internalRef ? String(internalRef) : undefined,
    returnUrl: returnUrl ? String(returnUrl) : undefined,
    webhookId,
    shopifyOrder: order,
  });
}

function handleDraftOrderUpdate(draftOrder: any) {
  console.info("[webhook/draft_orders/update]", {
    id: draftOrder?.id,
    status: draftOrder?.status,
    completedAt: draftOrder?.completed_at,
    orderId: draftOrder?.order_id,
  });
}

function handleOrderCreate(order: any) {
  console.info("[webhook/orders/create]", {
    id: order?.id,
    orderNumber: order?.order_number || order?.name,
    financialStatus: order?.financial_status,
  });
}

async function notifyPeptidemy(input: {
  internalOrderId?: string;
  internalRef?: string;
  returnUrl?: string;
  webhookId: string;
  shopifyOrder: any;
}) {
  const peptidemyWebhookUrl = process.env.PEPTIDEMY_WEBHOOK_URL?.trim();
  const handoffSecret = process.env.GLOW_HANDOFF_SECRET?.trim();

  if (!peptidemyWebhookUrl) {
    throw new Error("PEPTIDEMY_WEBHOOK_URL not configured");
  }
  if (!handoffSecret) {
    throw new Error("GLOW_HANDOFF_SECRET not configured for payment callback");
  }

  const order = input.shopifyOrder;
  const idempotencyKey =
    input.webhookId || `shopify-order-paid-${String(order?.id || "unknown")}`;
  const payload = {
    orderId: input.internalOrderId,
    orderRef: input.internalRef,
    status: "paid",
    shopifyWebhookId: input.webhookId || null,
    shopifyOrderId: order?.id != null ? String(order.id) : null,
    shopifyOrderNumber: order?.order_number || order?.name || null,
    totalPrice: order?.total_price != null ? String(order.total_price) : null,
    currency: order?.currency || null,
    paidAt: order?.processed_at || new Date().toISOString(),
    returnUrl: input.returnUrl || null,
  };
  const rawPayload = JSON.stringify(payload);
  const signature = createHmac("sha256", handoffSecret)
    .update(rawPayload, "utf8")
    .digest("hex");

  const res = await fetch(peptidemyWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Source": "zeroid-shopify",
      "X-ZeroID-Signature": signature,
      "X-Idempotency-Key": idempotencyKey,
    },
    body: rawPayload,
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Peptidemy payment callback failed ${res.status}: ${text.slice(0, 400)}`,
    );
  }

  console.info("[webhook] Peptidemy payment callback accepted", {
    idempotencyKey,
    internalOrderId: input.internalOrderId,
    internalRef: input.internalRef,
    shopifyOrderId: order?.id,
  });
}
