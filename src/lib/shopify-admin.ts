import type { HandoffLine, HandoffPayload } from "./handoff";
import { STORE_DOMAIN } from "./config";

const SHOP =
  process.env.SHOPIFY_SHOP_DOMAIN?.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  ) || STORE_DOMAIN;

const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || "";
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2024-10";

export function isShopifyAdminConfigured() {
  return !!(SHOP && ADMIN_TOKEN);
}

export async function createDraftOrderFromHandoff(
  payload: HandoffPayload,
): Promise<{ id: string; invoiceUrl: string }> {
  if (!ADMIN_TOKEN) {
    throw new Error("SHOPIFY_ADMIN_TOKEN is not set");
  }

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
        "X-Shopify-Access-Token": ADMIN_TOKEN,
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
