"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/shopify";

export function CartView() {
  const { items, subtotal, setQuantity, removeItem, ready, clear } = useCart();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Checkout failed");
      }
      // Clear local mirror cart once we hand off to Shopify
      clear();
      window.location.href = data.url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setLoading(false);
    }
  }

  if (!ready) {
    return <p className="text-stone-500">Loading cart…</p>;
  }

  if (!items.length) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="font-display text-4xl text-stone-900">Your cart is empty</h1>
        <Link
          href="/#collection"
          className="inline-block border border-stone-900 bg-stone-900 px-6 py-3 text-sm uppercase tracking-[0.14em] text-white"
        >
          Browse collection
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.4fr_0.8fr]">
      <div className="space-y-6">
        <h1 className="font-display text-4xl text-stone-900">Cart</h1>
        <ul className="divide-y divide-rose-100 border-y border-rose-100">
          {items.map((item) => (
            <li key={item.variantId} className="flex gap-4 py-5">
              <div className="relative h-24 w-20 shrink-0 overflow-hidden bg-rose-50">
                {item.image ? (
                  <Image
                    src={item.image}
                    alt={item.title}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${item.handle}`}
                  className="font-display text-xl leading-snug text-stone-900 hover:underline"
                >
                  {item.title}
                </Link>
                <p className="mt-1 text-sm text-stone-500">{formatMoney(item.price)}</p>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      setQuantity(
                        item.variantId,
                        Math.max(1, Number(e.target.value) || 1),
                      )
                    }
                    className="w-16 border border-stone-200 px-2 py-1.5 text-center text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(item.variantId)}
                    className="text-sm text-stone-500 underline-offset-2 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="text-sm font-medium text-stone-800">
                {formatMoney(Number(item.price) * item.quantity)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <aside className="h-fit space-y-4 border border-rose-100 bg-white/70 p-6">
        <div className="flex items-center justify-between text-stone-800">
          <span>Subtotal</span>
          <span className="text-lg font-medium">{formatMoney(subtotal)}</span>
        </div>
        <p className="text-xs leading-relaxed text-stone-500">
          Taxes and shipping are calculated on glowdevice.shop during the final
          Shopify checkout step.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="button"
          onClick={checkout}
          disabled={loading}
          className="w-full bg-stone-900 px-6 py-3.5 text-sm font-medium uppercase tracking-[0.14em] text-white transition hover:bg-stone-800 disabled:opacity-60"
        >
          {loading ? "Opening Glow checkout…" : "Checkout on glowdevice.shop"}
        </button>
      </aside>
    </div>
  );
}
