# Glow Device Storefront (middle app)

Two roles:

1. **Catalog mirror** — products from glowdevice.shop, cart `/go?lines=`
2. **Payment middle hop for peptides.my** — signed GET `/pay` creates Shopify Draft Order

## Peptides → Glow → Shopify (matched total + wellness names)

```
peptides.my  GET /api/orders/:id/pay/glow
  → glow  GET /pay?p=<payload>&sig=<hmac>
  → Shopify Draft Order invoice_url (302)
```

Peptides never holds Shopify Admin credentials.

### Env on glowdevice-storefront (Coolify)

```bash
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com   # or glowdevice.shop
SHOPIFY_ADMIN_TOKEN=shpat_...                  # custom app Admin API token
GLOW_HANDOFF_SECRET=same-long-secret-as-peptides
NEXT_PUBLIC_STOREFRONT_URL=https://your-glow-host
```

Shopify custom app scopes: `write_draft_orders`, `read_draft_orders`, `read_orders`, `write_orders`.

### Env on peptides.my

```bash
GLOW_STOREFRONT_URL=https://your-glow-host
GLOW_HANDOFF_SECRET=same-long-secret-as-peptides
```

## Catalog /go flow

```
GET /cart?lines=VARIANT:QTY
GET /go?lines=VARIANT:QTY   → Shopify cart permalink
```

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```
