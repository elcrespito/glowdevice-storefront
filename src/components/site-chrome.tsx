"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";
import { BRAND } from "@/lib/config";

export function SiteHeader() {
  const { count, ready } = useCart();

  return (
    <header className="sticky top-0 z-40 border-b border-rose-100/80 bg-[#fff8f6]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="group min-w-0">
          <p className="font-display text-2xl tracking-tight text-stone-900 sm:text-3xl">
            {BRAND.name}
          </p>
          <p className="truncate text-[11px] uppercase tracking-[0.22em] text-rose-400/90">
            {BRAND.tagline}
          </p>
        </Link>

        <nav className="flex items-center gap-5 text-sm text-stone-700">
          <Link
            href="/#collection"
            className="hidden transition hover:text-stone-950 sm:inline"
          >
            Collection
          </Link>
          <Link
            href="/cart"
            className="relative rounded-full border border-stone-900/10 bg-white/70 px-4 py-2 font-medium transition hover:border-stone-900/25 hover:bg-white"
          >
            Cart
            {ready && count > 0 ? (
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-stone-900 px-1.5 text-[11px] text-white">
                {count}
              </span>
            ) : null}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-rose-100/80 bg-[#fff8f6]">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="font-display text-lg text-stone-800">{BRAND.name}</p>
        <p>
          Secure checkout on{" "}
          <a
            href="https://glowdevice.shop"
            className="underline decoration-rose-300 underline-offset-4 hover:text-stone-800"
            target="_blank"
            rel="noreferrer"
          >
            glowdevice.shop
          </a>
        </p>
      </div>
    </footer>
  );
}
