import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { BRAND } from "@/lib/config";
import { fetchCatalog } from "@/lib/shopify";

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const products = await fetchCatalog();
  const heroImage =
    products[0]?.images[0]?.src ||
    products[0]?.image?.src ||
    null;

  return (
    <div>
      <section className="relative overflow-hidden border-b border-rose-100/70">
        {heroImage ? (
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              backgroundImage: `url('${heroImage}')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-r from-[#fff8f6]/95 via-[#fff8f6]/85 to-[#fff8f6]/35" />
        <div className="relative mx-auto flex min-h-[72vh] max-w-6xl flex-col justify-end px-4 pb-16 pt-24 sm:px-6 sm:pb-20">
          <p className="animate-rise text-xs uppercase tracking-[0.28em] text-rose-500">
            Professional consultations · Expert guidance
          </p>
          <h1 className="animate-rise-delay mt-3 max-w-2xl font-display text-5xl leading-[0.95] text-stone-900 sm:text-7xl">
            {BRAND.name}
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-stone-600 sm:text-lg">
            {BRAND.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="#collection"
              className="bg-stone-900 px-6 py-3.5 text-sm font-medium uppercase tracking-[0.14em] text-white transition hover:bg-stone-800"
            >
              View consultations
            </Link>
            <Link
              href="/cart"
              className="border border-stone-900/15 bg-white/70 px-6 py-3.5 text-sm font-medium uppercase tracking-[0.14em] text-stone-900 backdrop-blur transition hover:bg-white"
            >
              View cart
            </Link>
          </div>
        </div>
      </section>

      <section id="collection" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-10 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-rose-400">
              Available consultations
            </p>
            <h2 className="mt-2 font-display text-4xl text-stone-900">
              Our services
            </h2>
          </div>
          <p className="text-sm text-stone-500">{products.length} available</p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
}
