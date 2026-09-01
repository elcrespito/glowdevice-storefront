/**
 * Integration smoke: client_credentials → GET /admin/api/2026-07/shop.json === 200
 *
 * Usage:
 *   SHOPIFY_SHOP_DOMAIN=pawandmeow.myshopify.com \
 *   SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... \
 *   node --import tsx scripts/shopify-auth-smoke.ts
 *
 * Or: pnpm test:shopify-auth  (loads .env.local if present)
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-07";

async function main() {
  const { getAdminAccessToken, fetchShopJson, resolveShopifyAdminHost } =
    await import("../src/lib/shopify-admin");

  const shop = await resolveShopifyAdminHost();
  console.log(`[smoke] shop host: ${shop}`);
  console.log(`[smoke] api version: ${API_VERSION}`);

  if (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
    if (!process.env.SHOPIFY_ADMIN_TOKEN) {
      console.error(
        "[smoke] FAIL: set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN)",
      );
      process.exit(1);
    }
  }

  const token = await getAdminAccessToken();
  console.log(`[smoke] access_token acquired (len=${token.length})`);

  const { status, body } = await fetchShopJson(API_VERSION);
  console.log(`[smoke] GET /admin/api/${API_VERSION}/shop.json → ${status}`);

  if (status !== 200) {
    console.error("[smoke] FAIL body:", JSON.stringify(body).slice(0, 800));
    process.exit(1);
  }

  const name =
    typeof body === "object" &&
    body &&
    "shop" in body &&
    typeof (body as { shop?: { name?: string } }).shop?.name === "string"
      ? (body as { shop: { name: string } }).shop.name
      : "(unknown)";
  console.log(`[smoke] OK shop.name=${name}`);
}

main().catch((err) => {
  console.error("[smoke] FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
