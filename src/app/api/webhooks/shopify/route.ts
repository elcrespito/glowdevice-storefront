import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

type ShopifyNoteAttribute = {
  name?: string;
  value?: string | number | null;
};

type ShopifyOrderPayload = {
  id?: string | number | null;
  name?: string | null;
  order_number?: string | number | null;
  financial_status?: string | null;
  total_price?: string | number | null;
  currency?: string | null;
  processed_at?: string | null;
  note_attributes?: ShopifyNoteAttribute[] | null;
};

type ShopifyDraftOrderPayload = {
  id?: string | number | null;
  status?: string | null;
  completed_at?: string | null;
  order_id?: string | number | null;
};

/**
 * POST /api/webhooks/shopify
 *
 * Shopify `orders/paid` receiver. The draft-order flow stores Peptidemy's
 * internal order id/ref in note_attributes; after payment we forward a signed,
 * idempotent callback to Peptidemy.
 */
export async function POST(req: NextRequest) {
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

  let data: unknown;
  try {
    data = JSON.parse(body) as unknown;
  } catch (err) {
    console.error("[webhook] invalid JSON", err);
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const orderData = data as ShopifyOrderPayload;
  console.info("[webhook] received", {
    webhookId,
    topic,
    shop,
    shopifyOrderId: orderData?.id,
  });

  try {
    switch (topic) {
      case "orders/paid":
        await handleOrderPaid(orderData, webhookId);
        break;
      case "draft_orders/update":
        handleDraftOrderUpdate(data as ShopifyDraftOrderPayload);
        break;
      case "orders/create":
        handleOrderCreate(orderData);
        break;
      default:
        console.warn("[webhook] unhandled topic:", topic);
    }
  } catch (err) {
    console.error("[webhook] processing failed", { webhookId, topic, err });
    return NextResponse.json({ error: "processing_failed" }, { status: 502 });
  }

  return NextResponse.json({ received: true, webhookId: webhookId || undefined });
}

async function handleOrderPaid(order: ShopifyOrderPayload, webhookId: string) {
  const financialStatus = String(order.financial_status || "").toLowerCase();
  if (financialStatus && financialStatus !== "paid") {
    console.warn("[webhook/orders/paid] unexpected financial status", {
      webhookId,
      shopifyOrderId: order.id,
      financialStatus,
    });
    return;
  }

  const noteAttributes = Array.isArray(order.note_attributes)
    ? order.note_attributes
    : [];
  const internalOrderId = noteAttributes.find(
    (attr) => attr.name === "internal_order_id",
  )?.value;
  const internalRef = noteAttributes.find(
    (attr) => attr.name === "internal_ref",
  )?.value;
  const returnUrl = noteAttributes.find(
    (attr) => attr.name === "return_url",
  )?.value;

  console.info("[webhook/orders/paid]", {
    webhookId,
    shopifyOrderId: order.id,
    orderNumber: order.order_number || order.name,
    internalOrderId,
    internalRef,
    totalPrice: order.total_price,
    currency: order.currency,
    financialStatus,
  });

  if (!internalOrderId && !internalRef) {
    console.warn("[webhook/orders/paid] no Peptidemy correlation attributes", {
      webhookId,
      shopifyOrderId: order.id,
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

function handleDraftOrderUpdate(draftOrder: ShopifyDraftOrderPayload) {
  console.info("[webhook/draft_orders/update]", {
    id: draftOrder.id,
    status: draftOrder.status,
    completedAt: draftOrder.completed_at,
    orderId: draftOrder.order_id,
  });
}

function handleOrderCreate(order: ShopifyOrderPayload) {
  console.info("[webhook/orders/create]", {
    id: order.id,
    orderNumber: order.order_number || order.name,
    financialStatus: order.financial_status,
  });
}

async function notifyPeptidemy(input: {
  internalOrderId?: string;
  internalRef?: string;
  returnUrl?: string;
  webhookId: string;
  shopifyOrder: ShopifyOrderPayload;
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
    input.webhookId || `shopify-order-paid-${String(order.id || "unknown")}`;
  const payload = {
    orderId: input.internalOrderId,
    orderRef: input.internalRef,
    status: "paid",
    shopifyWebhookId: input.webhookId || null,
    shopifyOrderId: order.id != null ? String(order.id) : null,
    shopifyOrderNumber: order.order_number || order.name || null,
    totalPrice: order.total_price != null ? String(order.total_price) : null,
    currency: order.currency || null,
    paidAt: order.processed_at || new Date().toISOString(),
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
    shopifyOrderId: order.id,
  });
}
