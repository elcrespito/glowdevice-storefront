import { NextResponse } from "next/server";

/** Stable public completion hop used by Shopify's Continue shopping link. */
export function GET(request: Request) {
  const destination = new URL("https://peptidemy.com");
  const source = new URL(request.url);

  source.searchParams.forEach((value, key) => {
    if (key.startsWith("utm_")) destination.searchParams.set(key, value);
  });

  return NextResponse.redirect(destination, 302);
}
