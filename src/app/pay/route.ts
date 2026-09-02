import { NextRequest, NextResponse } from "next/server";
import {
  assertValidPayload,
  decodePayload,
  verifySignature,
} from "@/lib/handoff";
import {
  createDraftOrderFromHandoff,
  ensureOrdersPaidWebhook,
  isShopifyAdminConfigured,
} from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

/**
 * GET /pay?p=<base64url-json>&sig=<hmac>
 *
 * Middle hop: peptides.my never talks to Shopify.
 * Verifies HMAC → creates Draft Order with wellness lines → 302 to invoice URL.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.GLOW_HANDOFF_SECRET || "";
  if (!secret) {
    return NextResponse.json(
      { error: "handoff_unconfigured", message: "Set GLOW_HANDOFF_SECRET" },
      { status: 503 },
    );
  }
  if (!isShopifyAdminConfigured()) {
    return NextResponse.json(
      {
        error: "shopify_unconfigured",
        message:
          "Set SHOPIFY_SHOP_DOMAIN and SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or legacy SHOPIFY_ADMIN_TOKEN)",
      },
      { status: 503 },
    );
  }

  const p = req.nextUrl.searchParams.get("p");
  const sig = req.nextUrl.searchParams.get("sig");
  if (!p || !sig) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  if (!verifySignature(p, sig, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = decodePayload(p);
  } catch {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const invalid = assertValidPayload(payload);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  try {
    // Never create a checkout whose paid event has nowhere to go.
    await ensureOrdersPaidWebhook(req.nextUrl.origin);
    const draft = await createDraftOrderFromHandoff(payload);
    return NextResponse.redirect(draft.invoiceUrl, 302);
  } catch (err) {
    console.error("[pay] draft order failed", err);
    return NextResponse.json(
      {
        error: "draft_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}
