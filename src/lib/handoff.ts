import { createHmac, timingSafeEqual } from "crypto";

export type HandoffLine = {
  title: string;
  /** Decimal string, e.g. "49.00" */
  price: string;
  quantity: number;
  sku?: string;
};

export type HandoffPayload = {
  orderId: string;
  ref: string;
  email?: string | null;
  currency: string;
  totalMinor: number;
  lines: HandoffLine[];
  /** Unix seconds expiry */
  exp: number;
};

export function encodePayload(payload: HandoffPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePayload(encoded: string): HandoffPayload {
  const json = Buffer.from(encoded, "base64url").toString("utf8");
  return JSON.parse(json) as HandoffPayload;
}

export function signPayload(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function verifySignature(
  encoded: string,
  signature: string,
  secret: string,
): boolean {
  if (!encoded || !signature || !secret) return false;
  const expected = signPayload(encoded, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildPayUrl(
  storefrontBaseUrl: string,
  payload: HandoffPayload,
  secret: string,
): string {
  const p = encodePayload(payload);
  const sig = signPayload(p, secret);
  const base = storefrontBaseUrl.replace(/\/+$/, "");
  return `${base}/pay?p=${encodeURIComponent(p)}&sig=${encodeURIComponent(sig)}`;
}

export function assertValidPayload(payload: HandoffPayload): string | null {
  if (!payload.orderId || !payload.ref) return "missing_order";
  if (!payload.currency) return "missing_currency";
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    return "empty_lines";
  }
  if (!Number.isFinite(payload.totalMinor) || payload.totalMinor <= 0) {
    return "bad_total";
  }
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 < Date.now()) {
    return "expired";
  }
  for (const line of payload.lines) {
    if (!line.title || !line.price || !(line.quantity > 0)) return "bad_line";
  }
  return null;
}
