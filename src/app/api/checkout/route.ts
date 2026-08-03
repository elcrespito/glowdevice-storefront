import { NextResponse } from "next/server";
import { resolveCheckoutUrl, type CheckoutLine } from "@/lib/shopify";

export async function POST(req: Request) {
  let body: { lines?: CheckoutLine[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lines = (body.lines || [])
    .map((l) => ({
      variantId: Number(l.variantId),
      quantity: Number(l.quantity),
    }))
    .filter((l) => Number.isFinite(l.variantId) && l.variantId > 0 && l.quantity > 0);

  if (!lines.length) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }

  try {
    const checkout = await resolveCheckoutUrl(lines);
    return NextResponse.json(checkout);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Could not create Shopify checkout" },
      { status: 500 },
    );
  }
}
