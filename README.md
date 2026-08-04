# Glow Device Storefront

Mirror storefront for [glowdevice.shop](https://glowdevice.shop/). Catalog is pulled live from Shopify (`/products.json`). Checkout always finishes on glowdevice Shopify checkout.

## Flow (GET everywhere)

1. Browse identical products (handles, titles, prices, images from glowdevice).
2. Add to local cart, or land with query params.
3. Checkout is a pure GET hop:

```
GET /cart?lines=VARIANT:QTY,VARIANT:QTY   → seed cart on our site
GET /go?lines=VARIANT:QTY                 → 302 → Shopify checkout
```

Examples:

- Land + see cart: `https://YOUR_HOST/cart?lines=58086705103231:1`
- Straight to Shopify: `https://YOUR_HOST/go?lines=58086705103231:1`

Shopify side:
- Prefer **Storefront API** `cartCreate` → `checkoutUrl` when `SHOPIFY_STOREFRONT_TOKEN` is set
- Fallback: cart permalink `/cart/{variantId}:{qty}`

No encryption on `lines` for now — Shopify owns price; spoofing qty/variant only changes what the buyer pays for.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

### Env

| Variable | Required | Notes |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | no | default `glowdevice.shop` |
| `SHOPIFY_STOREFRONT_TOKEN` | recommended | Headless cart → native checkout URL |
| `NEXT_PUBLIC_STOREFRONT_URL` | for deploy | public URL of this mirror |

Create a custom app in Shopify Admin with Storefront API scopes:

- `unauthenticated_read_product_listings`
- `unauthenticated_write_checkouts` (or cart scopes for your API version)

## Deploy

Any Node host (Coolify / Vercel / Docker):

```bash
pnpm build && pnpm start
```

Set the env vars above on the host. Point DNS at this app; checkout still lands on `glowdevice.shop`.

## Notes

- Orders are processed by Shopify on glowdevice — this app does not take payment.
- Cart attributes `source=glowdevice-storefront` are attached when using Storefront API (and attempted via permalink query params).
