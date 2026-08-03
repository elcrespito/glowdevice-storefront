import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ProductGallery,
  ProductPurchase,
} from "@/components/product-purchase";
import {
  fetchCatalog,
  fetchProductByHandle,
  stripHtml,
} from "@/lib/shopify";

type Props = { params: { handle: string } };

export const revalidate = 300;

export async function generateStaticParams() {
  try {
    const products = await fetchCatalog();
    return products.map((p) => ({ handle: p.handle }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await fetchProductByHandle(params.handle);
  if (!product) return { title: "Product" };
  return {
    title: product.title,
    description: stripHtml(product.body_html).slice(0, 160),
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await fetchProductByHandle(params.handle);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <ProductGallery product={product} />
        <div className="space-y-8">
          <ProductPurchase product={product} />
          {product.body_html ? (
            <div
              className="prose-glow border-t border-rose-100 pt-8 text-sm"
              dangerouslySetInnerHTML={{ __html: product.body_html }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
