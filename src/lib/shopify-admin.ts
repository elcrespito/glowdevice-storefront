import type { HandoffPayload } from "./handoff";
import { STORE_BASE_URL, STORE_DOMAIN } from "./config";

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

  const base = cleaned.replace(/\.(shop|com|io|net|store)$/i, "");
  resolvedShopHost = `${base}.myshopify.com`;
  return resolvedShopHost;
}

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

async function getShopCurrency(): Promise<string> {
  const { status, body } = await fetchShopJson();
  if (status !== 200) return "USD";
  const currency = (body as { shop?: { currency?: string } })?.shop?.currency;
  return (currency || "USD").toUpperCase();
}

async function convertAmount(
  amount: number,
  from: string,
  to: string,
): Promise<number> {
  const src = from.toUpperCase();
  const dst = to.toUpperCase();
  if (src === dst) return amount;
  if (!Number.isFinite(amount)) return 0;

  try {
    const ctrl = AbortSignal.timeout(5000);
    const res = await fetch(
      `https://api.frankfurter.app/latest?amount=${encodeURIComponent(String(amount))}&from=${encodeURIComponent(src)}&to=${encodeURIComponent(dst)}`,
      { cache: "no-store", signal: ctrl },
    );
    if (!res.ok) throw new Error(`fx ${res.status}`);
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = json.rates?.[dst];
    if (typeof rate === "number" && Number.isFinite(rate)) return rate;
  } catch (err) {
    console.warn("[shopify-admin] FX convert failed, using 1:1", err);
  }
  return amount;
}

type GlowCatalogItem = { title: string; price: number };

async function fetchGlowCatalog(): Promise<GlowCatalogItem[]> {
  try {
    const res = await fetch(`${STORE_BASE_URL}/products.json?limit=250`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      products?: Array<{
        title: string;
        variants?: Array<{ price: string }>;
      }>;
    };
    return (data.products || [])
      .map((p) => ({
        title: p.title,
        price: Number(p.variants?.[0]?.price || 0),
      }))
      .filter((p) => p.title && p.price > 0);
  } catch {
    return [];
  }
}

function pickGlowTitle(
  targetPrice: number,
  catalog: GlowCatalogItem[],
  usedTitles: Set<string>,
): string {
  if (!catalog.length) return "Beauty Device Kit";
  const available = catalog.filter((c) => !usedTitles.has(c.title));
  const pool = available.length ? available : catalog;
  let best = pool[0];
  let bestDist = Math.abs(best.price - targetPrice);
  for (const item of pool) {
    const dist = Math.abs(item.price - targetPrice);
    if (dist < bestDist) {
      best = item;
      bestDist = dist;
    }
  }
  usedTitles.add(best.title);
  return best.title;
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Shopify rejects disposable/fake domains (e.g. wewe@ewwe.we). Omit bad emails. */
function shopifySafeEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim().toLowerCase();
  const m = trimmed.match(
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i,
  );
  if (!m) return undefined;
  const domain = m[1];
  const tld = domain.split(".").pop() || "";
  if (tld.length < 2) return undefined;
  if (/^(we|test|example|invalid|localhost)$/i.test(tld)) return undefined;
  if (/^(example\.com|example\.org|test\.com|localhost)$/i.test(domain)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Build draft line items in the Shopify shop currency with glowdevice catalog titles.
 * Keeps paid amount equal to handoff total (products + shipping gap).
 */
async function buildStorefrontLineItems(payload: HandoffPayload): Promise<{
  currency: string;
  lineItems: Array<{
    title: string;
    price: string;
    quantity: number;
    sku?: string;
    requires_shipping: boolean;
    taxable: boolean;
  }>;
}> {
  const shopCurrency = await getShopCurrency();
  const catalog = await fetchGlowCatalog();
  const usedTitles = new Set<string>();

  const convertedLines: Array<{
    title: string;
    unitPrice: number;
    quantity: number;
    sku?: string;
  }> = [];

  for (const line of payload.lines) {
    const qty = Math.max(1, Math.floor(line.quantity));
    const unitSrc = Number(line.price);
    const unitDst = await convertAmount(unitSrc, payload.currency, shopCurrency);
    const title = pickGlowTitle(unitDst, catalog, usedTitles);
    convertedLines.push({
      title,
      unitPrice: unitDst,
      quantity: qty,
      sku: line.sku,
    });
  }

  const productsTotal = convertedLines.reduce(
    (sum, l) => sum + l.unitPrice * l.quantity,
    0,
  );
  const orderTotalSrc = payload.totalMinor / 100;
  const orderTotalDst = await convertAmount(
    orderTotalSrc,
    payload.currency,
    shopCurrency,
  );
  const shippingGap = Math.round((orderTotalDst - productsTotal) * 100) / 100;

  const lineItems = convertedLines.map((l) => ({
    title: l.title,
    price: money(l.unitPrice),
    quantity: l.quantity,
    sku: l.sku,
    requires_shipping: false,
    taxable: false,
  }));

  if (shippingGap > 0.009) {
    lineItems.push({
      title: pickGlowTitle(shippingGap, catalog, usedTitles),
      price: money(shippingGap),
      quantity: 1,
      sku: "WS-SHIP",
      requires_shipping: false,
      taxable: false,
    });
  }

  return { currency: shopCurrency, lineItems };
}

export async function createDraftOrderFromHandoff(
  payload: HandoffPayload,
): Promise<{ id: string; invoiceUrl: string }> {
  const shop = await resolveShopifyAdminHost();
  const accessToken = await getAdminAccessToken();
  const { currency, lineItems } = await buildStorefrontLineItems(payload);
  const safeEmail = shopifySafeEmail(payload.email);

  async function postDraft(email?: string) {
    const body = {
      draft_order: {
        line_items: lineItems,
        currency,
        ...(email ? { email } : {}),
        note_attributes: [
          { name: "internal_order_id", value: payload.orderId },
          { name: "internal_ref", value: payload.ref },
          { name: "source", value: "peptides-handoff" },
          { name: "source_currency", value: payload.currency },
          { name: "source_total_minor", value: String(payload.totalMinor) },
          ...(payload.email
            ? [{ name: "customer_email_raw", value: String(payload.email) }]
            : []),
        ],
        note: "Glow Device order — fulfilment handled internally.",
        shipping_line: null,
        use_customer_default_address: false,
        tags: "peptides-handoff,glowdevice",
      },
    };

    return fetch(`https://${shop}/admin/api/${API_VERSION}/draft_orders.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  }

  let res = await postDraft(safeEmail);
  let text = await res.text().catch(() => "");

  if (
    !res.ok &&
    res.status === 422 &&
    safeEmail &&
    /email/i.test(text) &&
    /invalid domain/i.test(text)
  ) {
    console.warn(
      "[shopify-admin] email rejected by Shopify, retrying without email",
      safeEmail,
    );
    res = await postDraft(undefined);
    text = await res.text().catch(() => "");
  }

  if (!res.ok) {
    throw new Error(`Shopify draft_order failed ${res.status}: ${text.slice(0, 500)}`);
  }

  let json: { draft_order?: { id: number; invoice_url: string; total_price?: string; currency?: string } };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`Shopify draft_order bad JSON: ${text.slice(0, 300)}`);
  }

  const draft = json.draft_order;
  if (!draft?.id || !draft.invoice_url) {
    throw new Error("Shopify draft_order missing invoice_url");
  }

  console.info(
    "[shopify-admin] draft created",
    draft.id,
    draft.total_price,
    draft.currency,
    "←",
    payload.totalMinor / 100,
    payload.currency,
  );

  return { id: String(draft.id), invoiceUrl: draft.invoice_url };
}
