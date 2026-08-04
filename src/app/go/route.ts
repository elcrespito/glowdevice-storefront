import { NextRequest, NextResponse } from "next/server";
import { parseLinesParam } from "@/lib/checkout-params";
import { resolveCheckoutUrl } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * GET /go?lines=VARIANT:QTY,VARIANT:QTY
 * Pure GET hop → Shopify checkout (cart permalink or Storefront checkoutUrl).
 */
export async function GET(req: NextRequest) {
  const lines = parseLinesParam(req.nextUrl.searchParams.get("lines"));

  if (!lines.length) {
    return NextResponse.redirect(new URL("/cart", req.url), 302);
  }

  try {
    const checkout = await resolveCheckoutUrl(lines);
    return NextResponse.redirect(checkout.url, 302);
  } catch (err) {
    console.error(err);
    const fail = new URL("/cart", req.url);
    fail.searchParams.set("error", "checkout_failed");
    return NextResponse.redirect(fail, 302);
  }
}
