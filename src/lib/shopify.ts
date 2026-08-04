import {
  STORE_BASE_URL,
  STORE_DOMAIN,
  STOREFRONT_API_VERSION,
  STOREFRONT_PUBLIC_URL,
  STOREFRONT_TOKEN,
} from "./config";

export type ShopifyImage = {
  id: number;
  src: string;
  alt: string | null;
  width?: number;
  height?: number;
};

export type ShopifyVariant = {
  id: number;
  product_id: number;
  title: string;
  price: string;
  compare_at_price: string | null;
  sku: string | null;
  available?: boolean;
  option1: string | null;
  option2: string | null;
  option3: string | null;
};

export type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string[] | string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  image: ShopifyImage | null;
};

export type NormalizedProduct = Omit<ShopifyProduct, "tags"> & {
  tags: string[];
};

type ProductsJson = { products: ShopifyProduct[] };
type ProductJson = { product: ShopifyProduct };

function normalizeProduct(raw: ShopifyProduct): NormalizedProduct {
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : typeof raw.tags === "string"
      ? raw.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  return {
    ...raw,
    tags,
    images: raw.images || [],
    variants: raw.variants || [],
  };
}

export async function fetchCatalog(): Promise<NormalizedProduct[]> {
  const res = await fetch(`${STORE_BASE_URL}/products.json?limit=250`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Failed to load catalog from ${STORE_DOMAIN}: ${res.status}`);
  }
  const data = (await res.json()) as ProductsJson;
  return (data.products || []).map(normalizeProduct);
}

export async function fetchProductByHandle(
  handle: string,
): Promise<NormalizedProduct | null> {
  const res = await fetch(`${STORE_BASE_URL}/products/${handle}.json`, {
    next: { revalidate: 300 },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to load product ${handle}: ${res.status}`);
  }
  const data = (await res.json()) as ProductJson;
  return data.product ? normalizeProduct(data.product) : null;
}

export function formatMoney(amount: string | number, currency = "USD") {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Number.isFinite(value) ? value : 0);
}

export type CheckoutLine = {
  variantId: number;
  quantity: number;
};

/** Shopify cart permalink — no API token required. Ends on glowdevice checkout. */
export function buildCartPermalink(lines: CheckoutLine[]): string {
  if (!lines.length) {
    throw new Error("Cart is empty");
  }
  const path = lines
    .map((l) => `${l.variantId}:${Math.max(1, Math.floor(l.quantity))}`)
    .join(",");

  const params = new URLSearchParams({
    storefront: "mirror",
    "attributes[source]": "glowdevice-storefront",
    "attributes[mirror_url]": STOREFRONT_PUBLIC_URL,
  });

  // Cart permalink — Shopify redirects into checkout automatically.
  return `${STORE_BASE_URL}/cart/${path}?${params.toString()}`;
}

type StorefrontCartCreateResult = {
  data?: {
    cartCreate?: {
      cart?: { checkoutUrl?: string | null } | null;
      userErrors?: { message: string }[];
    };
  };
  errors?: { message: string }[];
};

/** Preferred when SHOPIFY_STOREFRONT_TOKEN is set — returns native Shopify checkoutUrl. */
export async function createStorefrontCheckout(
  lines: CheckoutLine[],
): Promise<string | null> {
  if (!STOREFRONT_TOKEN || !lines.length) return null;

  const mutation = `
    mutation cartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart { checkoutUrl }
        userErrors { field message }
      }
    }
  `;

  const input = {
    lines: lines.map((l) => ({
      merchandiseId: `gid://shopify/ProductVariant/${l.variantId}`,
      quantity: Math.max(1, Math.floor(l.quantity)),
    })),
    attributes: [
      { key: "source", value: "glowdevice-storefront" },
      { key: "mirror_url", value: STOREFRONT_PUBLIC_URL },
    ],
  };

  const res = await fetch(
    `https://${STORE_DOMAIN}/api/${STOREFRONT_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query: mutation, variables: { input } }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    console.error("Storefront cartCreate HTTP error", res.status);
    return null;
  }

  const json = (await res.json()) as StorefrontCartCreateResult;
  const payload = json.data?.cartCreate;
  const url = payload?.cart?.checkoutUrl;
  if (url) return url;

  console.error(
    "Storefront cartCreate failed",
    payload?.userErrors || json.errors,
  );
  return null;
}

export async function resolveCheckoutUrl(lines: CheckoutLine[]): Promise<{
  url: string;
  method: "storefront" | "permalink";
}> {
  const storefrontUrl = await createStorefrontCheckout(lines);
  if (storefrontUrl) {
    return { url: storefrontUrl, method: "storefront" };
  }
  return { url: buildCartPermalink(lines), method: "permalink" };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
