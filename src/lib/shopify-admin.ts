import type { HandoffLine, HandoffPayload } from "./handoff";
import { STORE_DOMAIN } from "./config";

/**
 * Shop host for Admin API / OAuth token endpoint.
 * Docs require: POST https://{shop}.myshopify.com/admin/oauth/access_token
 * Prefer *.myshopify.com (custom domains are resolved via /admin redirect).
 */
const SHOP_ENV =
  process.env.SHOPIFY_SHOP_DOMAIN?.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  ) || STORE_DOMAIN;

/** Default Admin API version for draft orders + smoke tests. */
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";

/** Legacy static Admin token (pre-2026 custom apps). Optional fallback. */
const LEGACY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";

/** Dev Dashboard app credentials (2026+). */
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";

type CachedToken = { token: string; expiresAtMs: number };
let cachedToken: CachedToken | null = null;
let resolvedShopHost: string | null = null;

export function isShopifyAdminConfigured() {
  return !!(
    SHOP_ENV &&
    (LEGACY_ADMIN_TOKEN || (CLIENT_ID && CLIENT_SECRET))
  );
}

/**
 * Official client_credentials host must be *.myshopify.com.
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */
export async function resolveShopifyAdminHost(
  shop = SHOP_ENV,
): Promise<string> {
  const cleaned = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (cleaned.endsWith(".myshopify.com")) return cleaned;

  if (resolvedShopHost) return resolvedShopHost;

  try {
    const res = await fetch(`https://${cleaned}/admin`, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
    });
    const loc = res.headers.get("location");
    if (loc) {
      const host = new URL(loc).hostname;
      if (host.endsWith(".myshopify.com")) {
        resolvedShopHost = host;
        return host;
      }
    }
  } catch {
    // fall through
  }

  // Common pattern: brand.shop → brand.myshopify.com
  const base = cleaned.replace(/\.(shop|com|io|net|store)$/i, "");
  resolvedShopHost = `${base}.myshopify.com`;
  return resolvedShopHost;
}

/**
 * Resolve Admin API access token.
 * Matches Shopify docs:
 *   POST https://{shop}.myshopify.com/admin/oauth/access_token
 *   Content-Type: application/x-www-form-urlencoded
 *   grant_type=client_credentials&client_id&client_secret
 * Response: { access_token, scope, expires_in: 86399 }
 * Then call Admin APIs with header X-Shopify-Access-Token.
 */
export async function getAdminAccessToken(): Promise<string> {
  if (CLIENT_ID && CLIENT_SECRET) {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAtMs - 120_000 > now) {
      return cachedToken.token;
    }

    const shop = await resolveShopifyAdminHost();
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Shopify client_credentials failed ${res.status}: ${text.slice(0, 400)}`,
      );
    }

    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!json.access_token) {
      throw new Error("Shopify client_credentials returned no access_token");
    }

    const expiresInSec = Number(json.expires_in) || 86399;
    cachedToken = {
      token: json.access_token,
      expiresAtMs: now + expiresInSec * 1000,
    };
    return cachedToken.token;
  }

  if (LEGACY_ADMIN_TOKEN) return LEGACY_ADMIN_TOKEN;

  throw new Error(
    "Set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or legacy SHOPIFY_ADMIN_TOKEN)",
  );
}

/** Smoke helper: GET /admin/api/{version}/shop.json with current auth. */
export async function fetchShopJson(
  apiVersion = API_VERSION,
): Promise<{ status: number; body: unknown }> {
  const shop = await resolveShopifyAdminHost();
  const accessToken = await getAdminAccessToken();
  const res = await fetch(
    `https://${shop}/admin/api/${apiVersion}/shop.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  const body = await res.json().catch(async () => res.text());
  return { status: res.status, body };
}

export async function createDraftOrderFromHandoff(
  payload: HandoffPayload,
): Promise<{ id: string; invoiceUrl: string }> {
  const shop = await resolveShopifyAdminHost();
  const accessToken = await getAdminAccessToken();

  const lineItems = payload.lines.map((line: HandoffLine) => ({
    title: line.title,
    price: line.price,
    quantity: line.quantity,
    sku: line.sku || undefined,
    requires_shipping: false,
    taxable: false,
  }));

  const body = {
    draft_order: {
      line_items: lineItems,
      currency: payload.currency,
      email: payload.email || undefined,
      note_attributes: [
        { name: "internal_order_id", value: payload.orderId },
        { name: "internal_ref", value: payload.ref },
        { name: "source", value: "peptides-handoff" },
      ],
      note: "Wellness order — fulfilment handled internally.",
      shipping_line: null,
      use_customer_default_address: false,
      tags: "peptides-handoff,wellness",
    },
  };

  const res = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/draft_orders.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify draft_order failed ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    draft_order?: { id: number; invoice_url: string };
  };

  const draft = json.draft_order;
  if (!draft?.id || !draft.invoice_url) {
    throw new Error("Shopify draft_order missing invoice_url");
  }

  return { id: String(draft.id), invoiceUrl: draft.invoice_url };
}
