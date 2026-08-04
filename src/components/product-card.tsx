import Image from "next/image";
import Link from "next/link";
import { formatMoney, type NormalizedProduct } from "@/lib/shopify";

export function ProductCard({ product }: { product: NormalizedProduct }) {
  const variant = product.variants[0];
  const image = product.image?.src || product.images[0]?.src;
  const price = variant?.price ?? "0";

  return (
    <Link
      href={`/products/${product.handle}`}
      className="group flex flex-col gap-3"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-rose-50 via-white to-amber-50">
        {image ? (
          <Image
            src={image}
            alt={product.title}
            width={800}
            height={1000}
            sizes="(max-width: 768px) 50vw, 25vw"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-stone-400">
            No image
          </div>
        )}
      </div>
      <div className="space-y-1">
        {product.product_type ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-rose-400">
            {product.product_type}
          </p>
        ) : null}
        <h2 className="font-display text-xl leading-snug text-stone-900 transition group-hover:text-stone-700">
          {product.title}
        </h2>
        <p className="text-sm text-stone-600">{formatMoney(price)}</p>
      </div>
    </Link>
  );
}
