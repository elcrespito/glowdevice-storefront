import type { HandoffLine, HandoffPayload } from "./handoff";
import { STORE_DOMAIN } from "./config";

/**
 * Shop host for Admin API / OAuth token endpoint.
 * Prefer *.myshopify.com (required for client_credentials).
 */
const SHOP =
  process.env.SHOPIFY_SHOP_DOMAIN?.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  ) || STORE_DOMAIN;

const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2024-10";

/** Legacy static Admin token (pre-2026 custom apps). Optional fallback. */
const LEGACY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";

/** Dev Dashboard app credentials (2026+). */
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";

type CachedToken = { token: string; expiresAtMs: number };
let cachedToken: CachedToken | null = null;

export function isShopifyAdminConfigured() {
  return !!(
    SHOP &&
    (LEGACY_ADMIN_TOKEN || (CLIENT_ID && CLIENT_SECRET))
  );
}

/**
 * Resolve Admin API access token.
 * - Prefer client_credentials (Client ID + Secret) — tokens expire ~24h, cached in-memory.
 * - Fallback: SHOPIFY_ADMIN_TOKEN if still available on older custom apps.
 */
async function getAdminAccessToken(): Promise<string> {
  if (CLIENT_ID && CLIENT_SECRET) {
    const now = Date.now();
    // Refresh 2 minutes before expiry
    if (cachedToken && cachedToken.expiresAtMs - 120_000 > now) {
      return cachedToken.token;
    }

    const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
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

export async function createDraftOrderFromHandoff(
  payload: HandoffPayload,
): Promise<{ id: string; invoiceUrl: string }> {
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
    `https://${SHOP}/admin/api/${API_VERSION}/draft_orders.json`,
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
