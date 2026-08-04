"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useCart, type CartItem } from "@/lib/cart";
import { parseLinesParam } from "@/lib/checkout-params";

type CatalogHint = {
  variantId: number;
  productId: number;
  handle: string;
  title: string;
  image: string | null;
  variantTitle: string;
  price: string;
};

/**
 * Hydrate local cart from GET ?lines=id:qty,id:qty when landing on the site.
 */
export function CartFromQuery({ catalog }: { catalog: CatalogHint[] }) {
  const searchParams = useSearchParams();
  const { ready, clear, addItem } = useCart();
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const raw = searchParams.get("lines");
    if (!raw) return;
    if (seededFor.current === raw) return;

    const lines = parseLinesParam(raw);
    if (!lines.length) return;

    seededFor.current = raw;
    const replace = searchParams.get("replace") !== "0";
    if (replace) clear();

    for (const line of lines) {
      const hint = catalog.find((c) => c.variantId === line.variantId);
      const item: Omit<CartItem, "quantity"> = hint
        ? {
            productId: hint.productId,
            handle: hint.handle,
            title: hint.title,
            image: hint.image,
            variantId: hint.variantId,
            variantTitle: hint.variantTitle,
            price: hint.price,
          }
        : {
            productId: 0,
            handle: "",
            title: `Variant ${line.variantId}`,
            image: null,
            variantId: line.variantId,
            variantTitle: "Default",
            price: "0",
          };
      addItem(item, line.quantity);
    }
  }, [ready, searchParams, catalog, clear, addItem]);

  return null;
}
