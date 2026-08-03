# Glow Device Storefront

Mirror storefront for [glowdevice.shop](https://glowdevice.shop/). Catalog is pulled live from Shopify (`/products.json`). Checkout always finishes on glowdevice Shopify checkout.

## Flow

1. Browse identical products (handles, titles, prices, images from glowdevice).
2. Add to local cart.
3. **Checkout** → `POST /api/checkout` → redirect to glowdevice:
   - Prefer **Storefront API** `cartCreate` → `checkoutUrl` when `SHOPIFY_STOREFRONT_TOKEN` is set
   - Fallback: Shopify **cart permalink** `/cart/{variantId}:{qty}`

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
