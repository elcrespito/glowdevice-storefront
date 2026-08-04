import type { CheckoutLine } from "./shopify";

/** Compact cart encoding: `variantId:qty,variantId:qty` */
export function buildLinesParam(lines: CheckoutLine[]): string {
  return lines
    .map((l) => {
      const id = Math.floor(Number(l.variantId));
      const qty = Math.max(1, Math.floor(Number(l.quantity) || 1));
      return `${id}:${qty}`;
    })
    .filter((part) => /^\d+:\d+$/.test(part))
    .join(",");
}

export function parseLinesParam(raw: string | null | undefined): CheckoutLine[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [idRaw, qtyRaw] = part.split(":");
      const variantId = Number(idRaw);
      const quantity = Math.max(1, Math.floor(Number(qtyRaw) || 1));
      return { variantId, quantity };
    })
    .filter(
      (l) =>
        Number.isFinite(l.variantId) &&
        l.variantId > 0 &&
        Number.isFinite(l.quantity) &&
        l.quantity > 0,
    );
}

/** Local hop to Shopify — pure GET, no POST body. */
export function buildGoCheckoutHref(lines: CheckoutLine[]): string {
  const encoded = buildLinesParam(lines);
  if (!encoded) return "/cart";
  return `/go?lines=${encodeURIComponent(encoded)}`;
}
