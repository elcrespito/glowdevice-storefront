"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";
import { formatMoney, type NormalizedProduct } from "@/lib/shopify";

export function ProductPurchase({ product }: { product: NormalizedProduct }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [variantId, setVariantId] = useState(product.variants[0]?.id);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState<"cart" | "buy" | null>(null);

  const variant =
    product.variants.find((v) => v.id === variantId) || product.variants[0];
  const image =
    product.images.find((img) => img.id === (variant as { image_id?: number })?.image_id)
      ?.src ||
    product.image?.src ||
    product.images[0]?.src ||
    null;

  if (!variant) return null;

  const payload = {
    productId: product.id,
    handle: product.handle,
    title: product.title,
    image,
    variantId: variant.id,
    variantTitle: variant.title,
    price: variant.price,
  };

  async function buyNow() {
    setBusy("buy");
    try {
      addItem(payload, qty);
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: [{ variantId: variant.id, quantity: qty }],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Checkout failed");
      }
      window.location.href = data.url as string;
    } catch (e) {
      console.error(e);
      setBusy(null);
      alert("Could not open Shopify checkout. Please try again.");
    }
  }

  function addToCart() {
    setBusy("cart");
    addItem(payload, qty);
    setBusy(null);
    router.push("/cart");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-rose-400">
          {product.product_type || "Beauty device"}
        </p>
        <h1 className="mt-2 font-display text-4xl leading-tight text-stone-900 sm:text-5xl">
          {product.title}
        </h1>
        <p className="mt-4 text-2xl text-stone-800">
          {formatMoney(variant.price)}
        </p>
      </div>

      {product.variants.length > 1 ? (
        <label className="block space-y-2 text-sm">
          <span className="text-stone-500">Option</span>
          <select
            className="w-full border border-stone-200 bg-white px-3 py-3 text-stone-900 outline-none focus:border-stone-400"
            value={variant.id}
            onChange={(e) => setVariantId(Number(e.target.value))}
          >
            {product.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} — {formatMoney(v.price)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-stone-600">
          Qty
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="w-16 border border-stone-200 bg-white px-2 py-2 text-center outline-none focus:border-stone-400"
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={addToCart}
          disabled={busy !== null}
          className="flex-1 border border-stone-900 bg-stone-900 px-6 py-3.5 text-sm font-medium uppercase tracking-[0.14em] text-white transition hover:bg-stone-800 disabled:opacity-60"
        >
          {busy === "cart" ? "Adding…" : "Add to cart"}
        </button>
        <button
          type="button"
          onClick={buyNow}
          disabled={busy !== null}
          className="flex-1 border border-rose-300 bg-rose-50 px-6 py-3.5 text-sm font-medium uppercase tracking-[0.14em] text-stone-900 transition hover:bg-rose-100 disabled:opacity-60"
        >
          {busy === "buy" ? "Redirecting…" : "Buy now — checkout on Glow"}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-stone-500">
        Payment and shipping are completed on glowdevice.shop Shopify checkout.
        Your cart is handed off with the same products and quantities.
      </p>
    </div>
  );
}

export function ProductGallery({ product }: { product: NormalizedProduct }) {
  const images = product.images.length
    ? product.images
    : product.image
      ? [product.image]
      : [];
  const [active, setActive] = useState(0);
  const current = images[active] || images[0];

  if (!current) {
    return (
      <div className="aspect-[4/5] bg-rose-50 text-stone-400 flex items-center justify-center">
        No image
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/5] overflow-hidden bg-gradient-to-br from-rose-50 via-white to-amber-50">
        <Image
          src={current.src}
          alt={current.alt || product.title}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
      </div>
      {images.length > 1 ? (
        <div className="grid grid-cols-5 gap-2">
          {images.slice(0, 5).map((img, idx) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(idx)}
              className={`relative aspect-square overflow-hidden border ${
                idx === active ? "border-stone-900" : "border-transparent"
              }`}
            >
              <Image
                src={img.src}
                alt=""
                fill
                sizes="80px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
