import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/shopify
 * 
 * Handles Shopify webhooks for order completion.
 * Configure in Shopify Admin → Settings → Notifications → Webhooks:
 * - orders/paid → https://your-domain/api/webhooks/shopify
 * - draft_orders/update → https://your-domain/api/webhooks/shopify
 * 
 * Shopify will sign with SHOPIFY_WEBHOOK_SECRET (from Shopify Admin).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
  if (!secret) {
    console.error("[webhook] SHOPIFY_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "webhook_unconfigured" },
      { status: 503 },
    );
  }

  const body = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic");
  const shop = req.headers.get("x-shopify-shop-domain");

  if (!hmacHeader) {
    console.error("[webhook] missing x-shopify-hmac-sha256");
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }

  // Verify HMAC signature
  const hash = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  const signatureBuffer = Buffer.from(hmacHeader);
  const hashBuffer = Buffer.from(hash);

  if (
    signatureBuffer.length !== hashBuffer.length ||
    !timingSafeEqual(signatureBuffer, hashBuffer)
  ) {
    console.error("[webhook] invalid signature");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  console.info("[webhook] received", topic, "from", shop);

  let data: any;
  try {
    data = JSON.parse(body);
  } catch (err) {
    console.error("[webhook] invalid JSON", err);
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Process webhook based on topic
  try {
    switch (topic) {
      case "orders/paid":
        await handleOrderPaid(data);
        break;
      case "draft_orders/update":
        await handleDraftOrderUpdate(data);
        break;
      case "orders/create":
        await handleOrderCreate(data);
        break;
      default:
        console.warn("[webhook] unhandled topic:", topic);
    }
  } catch (err) {
    console.error("[webhook] processing error", topic, err);
    // Still return 200 so Shopify doesn't retry
  }

  return NextResponse.json({ received: true });
}

async function handleOrderPaid(order: any) {
  console.info("[webhook/orders/paid]", {
    id: order.id,
    orderNumber: order.order_number || order.name,
    email: order.email,
    totalPrice: order.total_price,
    currency: order.currency,
    financialStatus: order.financial_status,
  });

  // Extract internal order ID from note_attributes
  const noteAttributes = order.note_attributes || [];
  const internalOrderId = noteAttributes.find(
    (attr: any) => attr.name === "internal_order_id"
  )?.value;
  const returnUrl = noteAttributes.find(
    (attr: any) => attr.name === "return_url"
  )?.value;

  if (internalOrderId) {
    console.info(
      "[webhook/orders/paid] internal order:",
      internalOrderId,
      "return:",
      returnUrl
    );

    // Optionally: Send webhook to peptidemy.com to notify about payment
    await notifyPeptidemy(internalOrderId, order);
  }
}

async function handleDraftOrderUpdate(draftOrder: any) {
  console.info("[webhook/draft_orders/update]", {
    id: draftOrder.id,
    status: draftOrder.status,
    completedAt: draftOrder.completed_at,
    orderId: draftOrder.order_id,
  });

  // When draft order is completed (converted to order)
  if (draftOrder.status === "completed" && draftOrder.order_id) {
    const noteAttributes = draftOrder.note_attributes || [];
    const internalOrderId = noteAttributes.find(
      (attr: any) => attr.name === "internal_order_id"
    )?.value;

    if (internalOrderId) {
      console.info(
        "[webhook/draft_orders/update] completed order:",
        internalOrderId,
        "shopify order:",
        draftOrder.order_id
      );
    }
  }
}

async function handleOrderCreate(order: any) {
  console.info("[webhook/orders/create]", {
    id: order.id,
    orderNumber: order.order_number || order.name,
    financialStatus: order.financial_status,
  });
}

async function notifyPeptidemy(internalOrderId: string, shopifyOrder: any) {
  const peptidemyWebhookUrl = process.env.PEPTIDEMY_WEBHOOK_URL;
  if (!peptidemyWebhookUrl) {
    console.warn(
      "[webhook] PEPTIDEMY_WEBHOOK_URL not configured, skipping notification"
    );
    return;
  }

  try {
    const payload = {
      orderId: internalOrderId,
      status: "paid",
      shopifyOrderId: shopifyOrder.id,
      shopifyOrderNumber: shopifyOrder.order_number || shopifyOrder.name,
      totalPrice: shopifyOrder.total_price,
      currency: shopifyOrder.currency,
      paidAt: shopifyOrder.processed_at || new Date().toISOString(),
    };

    const res = await fetch(peptidemyWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Source": "zeroid-shopify",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error(
        "[webhook] peptidemy notification failed:",
        res.status,
        await res.text().catch(() => "")
      );
    } else {
      console.info("[webhook] peptidemy notified:", internalOrderId);
    }
  } catch (err) {
    console.error("[webhook] peptidemy notification error:", err);
  }
}
