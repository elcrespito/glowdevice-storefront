import type { HandoffPayload } from "./handoff";
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
let ensuredOrdersPaidWebhookUri: string | null = null;

export function isShopifyAdminConfigured() {
  return !!(
    SHOP_ENV &&
    (LEGACY_ADMIN_TOKEN || (CLIENT_ID && CLIENT_SECRET))
  );
}

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


type ShopifyGraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

async function shopifyAdminGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const shop = await resolveShopifyAdminHost();
  const accessToken = await getAdminAccessToken();
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `Shopify GraphQL failed ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  let json: ShopifyGraphqlEnvelope<T>;
  try {
    json = JSON.parse(text) as ShopifyGraphqlEnvelope<T>;
  } catch {
    throw new Error(`Shopify GraphQL returned bad JSON: ${text.slice(0, 300)}`);
  }

  if (json.errors?.length) {
    throw new Error(
      `Shopify GraphQL errors: ${json.errors
        .map((error) => error.message || "unknown")
        .join("; ")}`,
    );
  }
  if (!json.data) throw new Error("Shopify GraphQL returned no data");
  return json.data;
}

/**
 * Ensures this installed app receives ORDERS_PAID before a checkout is created.
 * The operation is idempotent and cached after Shopify confirms the subscription.
 */
export async function ensureOrdersPaidWebhook(
  publicOrigin: string,
): Promise<{ id: string; uri: string; created: boolean }> {
  const origin = publicOrigin.replace(/\/+$/, "");
  if (!origin.startsWith("https://")) {
    throw new Error(`Webhook origin must be HTTPS: ${origin}`);
  }
  const uri = `${origin}/api/webhooks/shopify`;

  if (ensuredOrdersPaidWebhookUri === uri) {
    return { id: "cached", uri, created: false };
  }

  type ExistingResult = {
    webhookSubscriptions: {
      nodes: Array<{ id: string; topic: string; uri: string }>;
    };
  };
  const existing = await shopifyAdminGraphql<ExistingResult>(`
    query ExistingOrdersPaidWebhooks {
      webhookSubscriptions(first: 100, topics: [ORDERS_PAID]) {
        nodes { id topic uri }
      }
    }
  `);
  const match = existing.webhookSubscriptions.nodes.find(
    (subscription) => subscription.uri === uri,
  );
  if (match) {
    ensuredOrdersPaidWebhookUri = uri;
    console.info("[shopify-webhook] ORDERS_PAID subscription already active", match);
    return { id: match.id, uri, created: false };
  }

  type CreateResult = {
    webhookSubscriptionCreate: {
      webhookSubscription: { id: string; topic: string; uri: string } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  };
  const created = await shopifyAdminGraphql<CreateResult>(
    `
      mutation CreateOrdersPaidWebhook(
        $topic: WebhookSubscriptionTopic!
        $webhookSubscription: WebhookSubscriptionInput!
      ) {
        webhookSubscriptionCreate(
          topic: $topic
          webhookSubscription: $webhookSubscription
        ) {
          webhookSubscription { id topic uri }
          userErrors { field message }
        }
      }
    `,
    {
      topic: "ORDERS_PAID",
      webhookSubscription: { uri },
    },
  );
  const result = created.webhookSubscriptionCreate;
  if (result.userErrors.length) {
    throw new Error(
      `Shopify webhook subscription rejected: ${result.userErrors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
  if (!result.webhookSubscription) {
    throw new Error("Shopify webhook subscription was not created");
  }

  ensuredOrdersPaidWebhookUri = uri;
  console.info(
    "[shopify-webhook] ORDERS_PAID subscription created",
    result.webhookSubscription,
  );
  return {
    id: result.webhookSubscription.id,
    uri: result.webhookSubscription.uri,
    created: true,
  };
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

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

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

async function buildConsultationLineItems(payload: HandoffPayload): Promise<{
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
  const orderTotalSrc = payload.totalMinor / 100;
  const orderTotalDst = await convertAmount(
    orderTotalSrc,
    payload.currency,
    shopCurrency,
  );
  const consultationTitle = payload.lines[0]?.title || "ZEROID Consultation";

  const lineItems = [{
    title: consultationTitle,
    price: money(orderTotalDst),
    quantity: 1,
    sku: payload.lines[0]?.sku || "ZEROID-CONSULT",
    requires_shipping: false,
    taxable: false,
  }];

  return { currency: shopCurrency, lineItems };
}

export async function createDraftOrderFromHandoff(
  payload: HandoffPayload,
): Promise<{ id: string; invoiceUrl: string }> {
  const shop = await resolveShopifyAdminHost();
  const accessToken = await getAdminAccessToken();
  const { currency, lineItems } = await buildConsultationLineItems(payload);
  const safeEmail = shopifySafeEmail(payload.email);

  const returnUrl = process.env.PEPTIDEMY_RETURN_URL || "https://peptidemy.com";
  const returnUrlWithOrder = `${returnUrl}/orders/${payload.orderId}?status=paid`;

  async function postDraft(email?: string) {
    const body = {
      draft_order: {
        line_items: lineItems,
        currency,
        ...(email ? { email } : {}),
        note_attributes: [
          { name: "internal_order_id", value: payload.orderId },
          { name: "internal_ref", value: payload.ref },
          { name: "source", value: "peptidemy-zeroid" },
          { name: "source_currency", value: payload.currency },
          { name: "source_total_minor", value: String(payload.totalMinor) },
          { name: "return_url", value: returnUrlWithOrder },
          ...(payload.email
            ? [{ name: "customer_email_raw", value: String(payload.email) }]
            : []),
        ],
        note: `ZEROID consultation booking - Order #${payload.orderId}`,
        shipping_line: null,
        use_customer_default_address: false,
        tags: "peptidemy,zeroid-consultation",
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
    "return:",
    returnUrlWithOrder,
  );

  return { id: String(draft.id), invoiceUrl: draft.invoice_url };
}
