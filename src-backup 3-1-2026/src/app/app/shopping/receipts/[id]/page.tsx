"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ReceiptDetailRow = {
  receipt_id: string;
  receipt_created_at: string;
  store: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  food_tax_rate: number;
  sales_tax_rate: number;
  image_path: string | null;

  item_id: string | null;
  title: string | null;
  category: string | null;
  price: number | null;
  tax: number | null;
  purchased_at: string | null;
  purchased_by_name: string | null;
};

function getReceiptPublicUrl(path: string) {
  const { data } = supabase.storage.from("receipts").getPublicUrl(path);
  return data.publicUrl;
}

export default function ReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const receiptId = params.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReceiptDetailRow[]>([]);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");

    const { data, error } = await supabase.rpc("get_receipt_detail", { p_receipt_id: receiptId });
    if (error) {
      setErr(error.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load().catch((e) => {
      console.error(e);
      setErr("Failed to load receipt.");
      setLoading(false);
    });
  }, [receiptId]);

  const receipt = rows[0];

  const items = useMemo(() => {
    return rows
      .filter((r) => r.item_id)
      .map((r) => ({
        id: r.item_id!,
        title: r.title ?? "",
        category: (r.category ?? "").toLowerCase(),
        price: Number(r.price ?? 0),
        tax: Number(r.tax ?? 0),
        purchased_by_name: r.purchased_by_name ?? "Member",
      }));
  }, [rows]);

  const breakdown = useMemo(() => {
    const food = items.filter((i) => i.category === "food");
    const non = items.filter((i) => i.category !== "food");

    const sum = (arr: typeof items) =>
      arr.reduce(
        (acc, it) => {
          acc.price += it.price;
          acc.tax += it.tax;
          return acc;
        },
        { price: 0, tax: 0 }
      );

    const f = sum(food);
    const n = sum(non);
    return {
      food: { ...f, total: f.price + f.tax },
      nonfood: { ...n, total: n.price + n.tax },
    };
  }, [items]);

  if (loading) return <p className="p-6 text-white">Loading…</p>;

  if (err) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
        <Link href="/app/receipts" className="text-sm text-gray-300 hover:underline">
          ← Back to receipts
        </Link>
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-600/10 p-3 text-sm text-red-200">
          {err}
        </p>
      </main>
    );
  }

  if (!receipt) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
        <Link href="/app/receipts" className="text-sm text-gray-300 hover:underline">
          ← Back to receipts
        </Link>
        <p className="mt-4 text-gray-300">Receipt not found.</p>
      </main>
    );
  }

  const img = receipt.image_path ? getReceiptPublicUrl(receipt.image_path) : null;

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(receipt.receipt_created_at));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
      <Link href="/app/receipts" className="text-sm text-gray-300 hover:underline">
        ← Back to receipts
      </Link>

      <div className="mt-3 rounded-xl border border-white/20 bg-black p-4">
        <div className="flex items-start gap-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-white/20 bg-white/5">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img}
                alt="Receipt"
                className="h-full w-full object-cover"
                onClick={() => window.open(img!, "_blank")}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                No photo
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="truncate text-xl font-semibold">
                {receipt.store?.trim() ? receipt.store : "Receipt"}
              </div>
              <div className="shrink-0 text-xl font-semibold">
                ${Number(receipt.total ?? 0).toFixed(2)}
              </div>
            </div>

            <div className="mt-1 text-sm text-gray-300">{dateLabel}</div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm">
              <div className="rounded-lg border border-white/20 p-2">
                <div className="text-gray-400 text-xs">Subtotal</div>
                <div className="font-semibold">${Number(receipt.subtotal ?? 0).toFixed(2)}</div>
              </div>
              <div className="rounded-lg border border-white/20 p-2">
                <div className="text-gray-400 text-xs">Tax</div>
                <div className="font-semibold">${Number(receipt.tax_total ?? 0).toFixed(2)}</div>
              </div>
              <div className="rounded-lg border border-white/20 p-2">
                <div className="text-gray-400 text-xs">Rates</div>
                <div className="font-semibold">
                  Food {Number(receipt.food_tax_rate ?? 0).toFixed(2)}% / Sales{" "}
                  {Number(receipt.sales_tax_rate ?? 0).toFixed(2)}%
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
              <div className="rounded-lg border border-white/20 p-2">
                <div className="text-gray-400 text-xs">Food</div>
                <div className="font-semibold">
                  ${breakdown.food.total.toFixed(2)}{" "}
                  <span className="text-gray-400 font-normal">
                    (${breakdown.food.price.toFixed(2)} + ${breakdown.food.tax.toFixed(2)} tax)
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-white/20 p-2">
                <div className="text-gray-400 text-xs">Non-food</div>
                <div className="font-semibold">
                  ${breakdown.nonfood.total.toFixed(2)}{" "}
                  <span className="text-gray-400 font-normal">
                    (${breakdown.nonfood.price.toFixed(2)} + ${breakdown.nonfood.tax.toFixed(2)} tax)
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <hr className="my-4 border-white/10" />

        <h2 className="text-lg font-semibold">Items</h2>
        {items.length === 0 ? (
          <p className="mt-2 text-gray-300">No items linked to this receipt.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((it) => (
              <li key={it.id} className="rounded-lg border border-white/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{it.title}</div>
                    <div className="mt-1 text-xs text-gray-400">
                      Category: {it.category === "food" ? "food" : "non-food"} • Purchased by{" "}
                      {it.purchased_by_name}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <div>${it.price.toFixed(2)}</div>
                    <div className="text-gray-400">tax ${it.tax.toFixed(2)}</div>
                    <div className="font-semibold">${(it.price + it.tax).toFixed(2)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}