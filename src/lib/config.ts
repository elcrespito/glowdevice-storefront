export const STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN?.replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  ) || "pawandmeow.myshopify.com";

export const STORE_BASE_URL = `https://${STORE_DOMAIN}`;

export const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN || "";

export const STOREFRONT_API_VERSION =
  process.env.SHOPIFY_STOREFRONT_API_VERSION || "2024-10";

export const STOREFRONT_PUBLIC_URL =
  process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";

export const BRAND = {
  name: "Paw & Meow",
  tagline: "Premium Pet Care",
  description:
    "Curated selection of premium products for your beloved pets.",
} as const;
