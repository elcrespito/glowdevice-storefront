import type { Metadata } from "next";
import { Suspense } from "react";
import { CartFromQuery } from "@/components/cart-from-query";
import { CartView } from "@/components/cart-view";
import { fetchCatalog } from "@/lib/shopify";

export const metadata: Metadata = {
  title: "Cart",
};

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const products = await fetchCatalog().catch(() => []);
  const catalog = products.flatMap((p) =>
    p.variants.map((v) => ({
      variantId: v.id,
      productId: p.id,
      handle: p.handle,
      title: p.title,
      image: p.image?.src || p.images[0]?.src || null,
      variantTitle: v.title,
      price: v.price,
    })),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Suspense fallback={<p className="text-stone-500">Loading cart…</p>}>
        <CartFromQuery catalog={catalog} />
        <CartView />
      </Suspense>
    </div>
  );
}
