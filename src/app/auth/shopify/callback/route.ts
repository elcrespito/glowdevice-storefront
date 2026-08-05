import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "shopify_oauth_state";

/**
 * GET /auth/shopify/callback
 * Completes install (authorization code → offline token exchange).
 * After install, client_credentials grant works for Admin API.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.SHOPIFY_CLIENT_ID || "";
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "missing_credentials" },
      { status: 503 },
    );
  }

  const url = req.nextUrl;
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (!shop || !code) {
    return NextResponse.json(
      {
        error: "missing_params",
        hint: url.searchParams.get("error") || "expected shop+code",
      },
      { status: 400 },
    );
  }

  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "state_mismatch" }, { status: 400 });
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }).toString(),
    cache: "no-store",
  });

  const text = await tokenRes.text();
  if (!tokenRes.ok) {
    return NextResponse.json(
      {
        error: "token_exchange_failed",
        status: tokenRes.status,
        body: text.slice(0, 500),
      },
      { status: 502 },
    );
  }

  let json: { access_token?: string; scope?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return NextResponse.json(
      { error: "bad_token_response", body: text.slice(0, 300) },
      { status: 502 },
    );
  }

  if (!json.access_token) {
    return NextResponse.json(
      { error: "no_access_token", body: text.slice(0, 300) },
      { status: 502 },
    );
  }

  // Install complete — client_credentials can now mint Admin tokens.
  const html = `<!doctype html><html><body style="font-family:system-ui;padding:2rem">
  <h1>Shopify app installed</h1>
  <p>Shop: <code>${shop}</code></p>
  <p>Scopes: <code>${json.scope || "(none)"}</code></p>
  <p>You can close this tab and re-run <code>pnpm test:shopify-auth</code>.</p>
  </body></html>`;

  const res = new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  res.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
