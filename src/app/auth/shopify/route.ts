import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "shopify_oauth_state";

/**
 * GET /auth/shopify
 * Starts authorization-code install so client_credentials can work afterward.
 * Register redirect URL in Dev Dashboard:
 *   {NEXT_PUBLIC_STOREFRONT_URL}/auth/shopify/callback
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.SHOPIFY_CLIENT_ID || "";
  if (!clientId) {
    return NextResponse.json(
      { error: "missing_client_id", message: "Set SHOPIFY_CLIENT_ID" },
      { status: 503 },
    );
  }

  const shopParam = req.nextUrl.searchParams.get("shop");
  const shop = (
    shopParam ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    "zeroid-2.myshopify.com"
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  const scopes =
    process.env.SHOPIFY_SCOPES ||
    "write_draft_orders,read_draft_orders,read_orders,write_orders,read_products,read_locations";

  const publicBase = (
    process.env.NEXT_PUBLIC_STOREFRONT_URL || req.nextUrl.origin
  ).replace(/\/$/, "");
  const redirectUri = `${publicBase}/auth/shopify/callback`;

  const state = randomBytes(16).toString("hex");
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: publicBase.startsWith("https"),
    maxAge: 600,
    path: "/",
  });
  return res;
}
