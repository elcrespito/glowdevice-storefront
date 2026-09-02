import { NextResponse } from "next/server";

/**
 * Stable public return hop for Shopify's “Continue shopping” URL.
 * Keeping Shopify pointed here lets us change the destination later without
 * editing the Shopify store configuration again.
 */
export function GET(request: Request) {
  const destination = new URL("https://peptidemy.com");
  const source = new URL(request.url);

  // Preserve campaign params if Shopify ever appends them, but never forward
  // arbitrary path/query data that could turn this into an open redirect.
  source.searchParams.forEach((value, key) => {
    if (key.startsWith("utm_")) destination.searchParams.set(key, value);
  });

  return NextResponse.redirect(destination, 302);
}
