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
  scanned_at: string | null;
};

type ReceiptWithUrls = ReceiptRow & {
  thumb_url: string | null;
};

type FilterMode = "all" | "unscanned" | "scanned";

function monthLabel(d: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(d);
}

function dateLine(d: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

async function signedUrl(path: string, seconds = 60 * 60) {
  const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, seconds);
  if (error) return null;
  return data.signedUrl;
}

export default function ReceiptsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReceiptWithUrls[]>([]);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  const load = async () => {
    setLoading(true);
    setErr("");

    const { data: active, error: aErr } = await supabase.rpc("get_active_household");
    if (aErr) {
      setErr(aErr.message);
      setRows([]);
      setLoading(false);
      return;
    }
    if (!active) {
      setErr("No active household selected.");
      setRows([]);
      setLoading(false);
      return;
    }

    // Pull scanned_at directly from receipts so the list reflects toggles immediately.
    const { data, error } = await supabase
      .from("receipts")
      .select(
        "id,created_at,store,subtotal,tax_total,total,food_tax_rate,sales_tax_rate,image_path,scanned_at"
      )
      .eq("household_id", active)
      .order("created_at", { ascending: false });

    if (error) {
      setErr(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const base = (data ?? []) as ReceiptRow[];

    // Generate signed thumbnail URLs (fixes broken images when bucket is private)
    const withUrls: ReceiptWithUrls[] = await Promise.all(
      base.map(async (r) => {
        if (!r.image_path) return { ...r, thumb_url: null };
        const url = await signedUrl(r.image_path);
        return { ...r, thumb_url: url };
      })
    );

    setRows(withUrls);
    setLoading(false);
  };

  useEffect(() => {
    load().catch((e) => {
      console.error(e);
      setErr("Failed to load receipts.");
      setLoading(false);
    });
  }, []);

  const counts = useMemo(() => {
    const scanned = rows.filter((r) => !!r.scanned_at).length;
    const unscanned = rows.length - scanned;
    return { total: rows.length, scanned, unscanned };
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === "scanned") return rows.filter((r) => !!r.scanned_at);
    if (filter === "unscanned") return rows.filter((r) => !r.scanned_at);
    return rows;
  }, [rows, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReceiptWithUrls[]>();
    for (const r of filtered) {
      const key = monthLabel(new Date(r.created_at));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const toggleScanned = async (receiptId: string, next: boolean) => {
    const nextVal = next ? new Date().toISOString() : null;

    // optimistic UI update
    setRows((prev) => prev.map((r) => (r.id === receiptId ? { ...r, scanned_at: nextVal } : r)));

    const { error } = await supabase
      .from("receipts")
      .update({ scanned_at: nextVal })
      .eq("id", receiptId);

    if (error) {
      // rollback
      await load();
      alert(error.message);
    }
  };

  const deleteReceipt = async (r: ReceiptWithUrls) => {
    if (!confirm(`Delete receipt${r.store ? ` “${r.store}”` : ""}? This cannot be undone.`)) return;

    // 1) delete image (if any)
    if (r.image_path) {
      const { error: sErr } = await supabase.storage.from("receipts").remove([r.image_path]);
      if (sErr) {
        alert(`Failed to delete image: ${sErr.message}`);
        return;
      }
    }

    // 2) delete receipt row
    const { error } = await supabase.from("receipts").delete().eq("id", r.id);
    if (error) {
      alert(error.message);
      return;
    }

    // remove from UI
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  };

  const [fullImg, setFullImg] = useState<string | null>(null);

  if (loading) return <p className="p-6 text-white">Loading…</p>;

  if (err) {
    return (
      <main className="mx-auto max-w-4xl p-4 sm:p-6 text-white">
        <p className="rounded-lg border border-red-400/40 bg-red-600/10 p-3 text-sm text-red-200">
          {err}
        </p>
        <div className="mt-4">
          <Link href="/app/shopping" className="text-sm text-gray-300 hover:underline">
            ← Back to Shopping
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Receipts</h1>
          <Link href="/app/shopping" className="mt-2 inline-block text-sm text-gray-300 hover:underline">
            ← Back to Shopping
          </Link>
        </div>

        <button
          className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
          onClick={() => load()}
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${
              filter === "all" ? "border-white/40 bg-white/10" : "border-white/20 hover:bg-white/10"
            }`}
            onClick={() => setFilter("all")}
          >
            All ({counts.total})
          </button>
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${
              filter === "unscanned" ? "border-white/40 bg-white/10" : "border-white/20 hover:bg-white/10"
            }`}
            onClick={() => setFilter("unscanned")}
          >
            Unscanned ({counts.unscanned})
          </button>
          <button
            className={`rounded-lg border px-3 py-2 text-sm ${
              filter === "scanned" ? "border-white/40 bg-white/10" : "border-white/20 hover:bg-white/10"
            }`}
            onClick={() => setFilter("scanned")}
          >
            Scanned ({counts.scanned})
          </button>
        </div>

        <div className="text-sm text-gray-300">
          Total: <span className="font-semibold">{counts.total}</span> • Scanned:{" "}
          <span className="font-semibold text-green-300">{counts.scanned}</span> • Unscanned:{" "}
          <span className="font-semibold">{counts.unscanned}</span>
        </div>
      </div>

      <div className="mt-5 space-y-6">
        {grouped.length === 0 ? (
          <p className="text-gray-300">No receipts found.</p>
        ) : (
          grouped.map(([month, list]) => (
            <section key={month}>
              <div className="mb-2 text-sm text-gray-300">{month}</div>

              <div className="space-y-3">
                {list.map((r) => {
                  const isScanned = !!r.scanned_at;
                  const dt = new Date(r.created_at);

                  return (
                    <div
                      key={r.id}
                      className="rounded-xl border border-white/20 bg-black p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-white/5">
                            {r.thumb_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={r.thumb_url}
                                alt="Receipt"
                                className="h-full w-full object-cover"
                                onClick={() => setFullImg(r.thumb_url)}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">
                                No photo
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/app/shopping/receipts/${r.id}`}
                                className="truncate text-lg font-semibold hover:underline"
                              >
                                {r.store?.trim() ? r.store : "Receipt"}
                              </Link>

                              {/* Badge */}
                              {isScanned ? (
                                <span className="rounded-full bg-green-600/20 px-2 py-0.5 text-xs text-green-300 border border-green-500/30">
                                  Scanned
                                </span>
                              ) : (
                                <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-300 border border-white/10">
                                  Unscanned
                                </span>
                              )}
                            </div>

                            <div className="mt-1 text-xs text-gray-300">
                              {dateLine(dt)} • Subtotal ${Number(r.subtotal ?? 0).toFixed(2)} • Tax ${Number(r.tax_total ?? 0).toFixed(2)}
                            </div>

                            {/* IMPORTANT: removed “Not scanned” text from this line */}
                            <div className="mt-1 text-xs text-gray-400">
                              Food {Number(r.food_tax_rate ?? 0).toFixed(2)}% / Sales{" "}
                              {Number(r.sales_tax_rate ?? 0).toFixed(2)}%
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <div className="text-lg font-semibold">${Number(r.total ?? 0).toFixed(2)}</div>

                          {/* Keep scanned status by the total */}
                          <div className="mt-1 text-xs">
                            {isScanned ? (
                              <span className="text-green-300">
                                Scanned on{" "}
                                {new Intl.DateTimeFormat(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                }).format(new Date(r.scanned_at!))}
                              </span>
                            ) : (
                              <span className="text-gray-400">Not scanned</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                          onClick={() => toggleScanned(r.id, !isScanned)}
                        >
                          {isScanned ? "Mark not scanned" : "Mark scanned"}
                        </button>

                        <button
                          className="rounded-lg border border-red-400/50 px-3 py-2 text-sm text-red-200 hover:bg-red-600/20"
                          onClick={() => deleteReceipt(r)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      {/* Full image modal */}
      {fullImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setFullImg(null)}
        >
          <div
            className="max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl border border-white/20 bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fullImg} alt="Receipt full view" className="h-full w-full object-contain" />
          </div>
        </div>
      )}
    </main>
  );
}