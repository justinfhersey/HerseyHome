"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type ReceiptRow = {
  id: string;
  created_at: string;
  store: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  food_tax_rate: number;
  sales_tax_rate: number;
  image_path: string | null;
};

function getReceiptPublicUrl(path: string) {
  const { data } = supabase.storage.from("receipts").getPublicUrl(path);
  return data.publicUrl;
}

export default function ReceiptsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [err, setErr] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr("");

    const { data, error } = await supabase.rpc("get_receipts_for_active_household");
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
      setErr("Failed to load receipts.");
      setLoading(false);
    });
  }, []);

  const monthGroups = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long" });
    const m = new Map<string, ReceiptRow[]>();
    for (const r of rows) {
      const k = fmt.format(new Date(r.created_at));
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return Array.from(m.entries());
  }, [rows]);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <button
          onClick={load}
          className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="mt-4 text-gray-300">Loading…</p>}
      {!loading && err && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-600/10 p-3 text-sm text-red-200">
          {err}
        </p>
      )}

      {!loading && !err && rows.length === 0 && (
        <p className="mt-4 text-gray-300">No receipts yet. Add a receipt from Shopping → Receipt mode.</p>
      )}

      <div className="mt-4 space-y-6">
        {monthGroups.map(([month, receipts]) => (
          <section key={month}>
            <h2 className="text-sm font-medium text-gray-300">{month}</h2>

            <ul className="mt-2 space-y-3">
              {receipts.map((r) => {
                const img = r.image_path ? getReceiptPublicUrl(r.image_path) : null;
                const dateLabel = new Intl.DateTimeFormat(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                }).format(new Date(r.created_at));

                return (
                  <li key={r.id} className="rounded-xl border border-white/20 bg-black p-3">
                    <Link href={`/app/receipts/${r.id}`} className="flex items-center gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-white/5">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="Receipt" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                            No photo
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate font-medium">
                            {r.store?.trim() ? r.store : "Receipt"}
                          </div>
                          <div className="shrink-0 font-semibold">${Number(r.total ?? 0).toFixed(2)}</div>
                        </div>

                        <div className="mt-1 text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-1">
                          <span>{dateLabel}</span>
                          <span>
                            Subtotal ${Number(r.subtotal ?? 0).toFixed(2)}
                          </span>
                          <span>
                            Tax ${Number(r.tax_total ?? 0).toFixed(2)}
                          </span>
                          <span>
                            Food {Number(r.food_tax_rate ?? 0).toFixed(2)}% / Sales{" "}
                            {Number(r.sales_tax_rate ?? 0).toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      <span className="shrink-0 text-gray-500">›</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}