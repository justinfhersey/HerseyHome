"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Row = {
  bill_id: string;
  name: string;
  category: string | null;
  vendor: string | null;
  notes: string | null;
  is_variable: boolean;
  default_amount: number | null;
  recurrence_freq: string;
  recurrence_interval: number;
  next_due_at: string;
  autopay: boolean;
  is_active: boolean;
  created_at: string;

  payment_id: string | null;
  paid_at: string | null;
  amount: number | null;
  paid_by_name: string | null;
  note: string | null;
};

export default function BillDetailPage() {
  const params = useParams<{ id: string }>();
  const billId = params.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paying, setPaying] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");

    const { data, error } = await supabase.rpc("get_bill_detail", { p_bill_id: billId });
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
      setErr("Failed to load bill.");
      setLoading(false);
    });
  }, [billId]);

  const bill = rows[0];

  const payments = useMemo(() => {
    return rows
      .filter((r) => r.payment_id)
      .map((r) => ({
        id: r.payment_id!,
        paid_at: r.paid_at!,
        amount: Number(r.amount ?? 0),
        paid_by_name: r.paid_by_name ?? "Member",
        note: r.note ?? null,
      }));
  }, [rows]);

  const pay = async () => {
    if (!bill) return;

    const amt = amount.trim() === "" ? bill.default_amount : Number(amount);
    if (amt == null) return alert("Enter an amount.");
    if (Number.isNaN(amt)) return alert("Amount must be a number.");

    setPaying(true);
    const { error } = await supabase.rpc("pay_bill", {
      p_bill_id: bill.bill_id,
      p_amount: amt,
      p_paid_at: new Date().toISOString(),
      p_note: note.trim(),
    });

    if (error) alert(error.message);

    setAmount("");
    setNote("");
    setPaying(false);
    await load();
  };

  if (loading) return <p className="p-6 text-white">Loading…</p>;

  if (err) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
        <Link href="/app/bills" className="text-sm text-gray-300 hover:underline">
          ← Back to bills
        </Link>
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-600/10 p-3 text-sm text-red-200">
          {err}
        </p>
      </main>
    );
  }

  if (!bill) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
        <Link href="/app/bills" className="text-sm text-gray-300 hover:underline">
          ← Back to bills
        </Link>
        <p className="mt-4 text-gray-300">Bill not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
      <Link href="/app/bills" className="text-sm text-gray-300 hover:underline">
        ← Back to bills
      </Link>

      <div className="mt-3 rounded-xl border border-white/20 bg-black p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold">{bill.name}</div>
            <div className="mt-1 text-sm text-gray-300">
              {bill.vendor ? bill.vendor : "—"} {bill.category ? `• ${bill.category}` : ""}
            </div>
            <div className="mt-1 text-xs text-gray-400">
              Next due: <span className="font-semibold text-white">{bill.next_due_at}</span> •{" "}
              {bill.recurrence_freq === "none"
                ? "One-time"
                : `${bill.recurrence_freq} (every ${bill.recurrence_interval})`}
              {bill.autopay ? " • Autopay" : ""}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-xs text-gray-400">Default</div>
            <div className="text-xl font-semibold">
              {bill.is_variable ? "Varies" : `$${Number(bill.default_amount ?? 0).toFixed(2)}`}
            </div>
          </div>
        </div>

        {bill.notes && (
          <div className="mt-3 rounded-lg border border-white/20 bg-white/5 p-3 text-sm text-gray-200">
            {bill.notes}
          </div>
        )}

        <hr className="my-4 border-white/10" />

        <h2 className="text-lg font-semibold">Mark as paid</h2>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className="block text-sm text-gray-300">Amount</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={bill.is_variable ? "e.g., 83.21" : `Default: ${bill.default_amount ?? ""}`}
              inputMode="decimal"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-300">Note (optional)</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Paid via checking"
            />
          </div>
        </div>

        <button
          className="mt-3 rounded-lg bg-white px-4 py-2 text-black disabled:opacity-60"
          onClick={pay}
          disabled={paying}
        >
          {paying ? "Saving…" : "Mark paid"}
        </button>

        <hr className="my-4 border-white/10" />

        <h2 className="text-lg font-semibold">Payment history</h2>
        {payments.length === 0 ? (
          <p className="mt-2 text-gray-300">No payments recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {payments.map((p) => (
              <li key={p.id} className="rounded-lg border border-white/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">${p.amount.toFixed(2)}</div>
                    <div className="mt-1 text-xs text-gray-400">
                      Paid by {p.paid_by_name} • {new Date(p.paid_at).toLocaleString()}
                    </div>
                    {p.note && <div className="mt-2 text-sm text-gray-200">{p.note}</div>}
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