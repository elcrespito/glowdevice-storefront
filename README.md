# ZEROID Consultation Storefront

Professional consultation booking platform with Shopify payment processing.

## Features

1. **Consultation Booking** — Browse and book consultations from Shopify catalog
2. **Payment Processing** — Secure Shopify Draft Order checkout
3. **Peptidemy Integration** — Signed handoff from peptidemy.com
4. **Webhooks** — Real-time payment notifications back to peptidemy.com
5. **Return Flow** — Automatic redirect to peptidemy.com after payment

## Flow: Peptidemy → ZEROID → Shopify

```
peptidemy.com  GET /api/orders/:id/pay/zeroid
  → zeroid  GET /pay?p=<payload>&sig=<hmac>
  → Shopify Draft Order invoice_url (302)
  → [Customer pays on Shopify]
  → Shopify redirects to peptidemy.com/orders/:id?status=paid
  → Shopify webhook → /api/webhooks/shopify
  → zeroid notifies peptidemy.com/api/webhooks/zeroid
```

Peptidemy never holds Shopify Admin credentials.

### Env on zeroid-storefront (Coolify)

```bash
SHOPIFY_SHOP_DOMAIN=zeroid-2.myshopify.com   # *.myshopify.com required for auth
SHOPIFY_CLIENT_ID=...                        # Dev Dashboard app
SHOPIFY_CLIENT_SECRET=...
GLOW_HANDOFF_SECRET=same-long-secret-as-peptidemy
NEXT_PUBLIC_STOREFRONT_URL=https://your-zeroid-host
PEPTIDEMY_RETURN_URL=https://peptidemy.com
SHOPIFY_WEBHOOK_SECRET=...                   # From Shopify webhook settings
PEPTIDEMY_WEBHOOK_URL=https://peptidemy.com/api/webhooks/zeroid
```

App scopes: `write_draft_orders`, `read_draft_orders`, `read_orders`, `write_orders`, `read_products`.

> In 2026 classic `shpat_` Admin tokens are no longer issued for new Dev Dashboard apps.
> ZEROID exchanges Client ID + Secret via `client_credentials` (24h token, cached).
> Optional legacy fallback: `SHOPIFY_ADMIN_TOKEN`.

### Env on peptidemy.com

```bash
ZEROID_STOREFRONT_URL=https://your-zeroid-host
GLOW_HANDOFF_SECRET=same-long-secret-as-zeroid
```

### Shopify Webhook Setup

In Shopify Admin → Settings → Notifications → Webhooks, add:

1. **orders/paid** → `https://your-zeroid-host/api/webhooks/shopify`
   - Format: JSON
   - Get the webhook secret and set it as `SHOPIFY_WEBHOOK_SECRET`

2. **draft_orders/update** (optional) → same URL

The webhook will notify peptidemy.com when payment completes.

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

## Testing Handoff Locally

```bash
# Test signed handoff payload
SHOPIFY_SHOP_DOMAIN=zeroid-2.myshopify.com \
SHOPIFY_CLIENT_ID=... \
SHOPIFY_CLIENT_SECRET=... \
GLOW_HANDOFF_SECRET=your-secret \
pnpm test:shopify-auth
```
