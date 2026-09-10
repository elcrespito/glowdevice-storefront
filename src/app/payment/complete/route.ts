import { NextRequest, NextResponse } from "next/server";
import { verifySignature } from "@/lib/handoff";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("orderId");
  const signature = req.nextUrl.searchParams.get("sig");
  const secret = process.env.GLOW_HANDOFF_SECRET || "";

  if (!orderId || !signature) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  if (
    !secret ||
    !verifySignature(`payment-return:${orderId}`, signature, secret)
  ) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const peptidemyBase =
    process.env.PEPTIDEMY_RETURN_URL || "https://peptidemy.com";
  const destination = new URL(
    `/orders/${encodeURIComponent(orderId)}`,
    peptidemyBase,
  );
  destination.searchParams.set("status", "paid");

  return NextResponse.redirect(destination, 302);
}
