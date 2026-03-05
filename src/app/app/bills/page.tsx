"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type BillRow = {
  id: string;
  name: string;
  category: string | null;
  vendor: string | null;
  is_variable: boolean;
  default_amount: number | null;
  recurrence_freq: string;
  recurrence_interval: number;
  next_due_at: string; // date
  autopay: boolean;
  is_active: boolean;
  created_at: string;
};

function daysUntil(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = d.getTime() - start.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

export default function BillsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BillRow[]>([]);
  const [err, setErr] = useState("");

  // create form
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [isVariable, setIsVariable] = useState(false);
  const [defaultAmount, setDefaultAmount] = useState("");
  const [freq, setFreq] = useState("monthly");
  const [interval, setInterval] = useState("1");
  const [nextDue, setNextDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [autopay, setAutopay] = useState(false);
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    setErr("");

    const { data, error } = await supabase.rpc("get_bills_for_active_household");
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
      setErr("Failed to load bills.");
      setLoading(false);
    });
  }, []);

  const buckets = useMemo(() => {
    const active = rows.filter((b) => b.is_active);
    const overdue = active.filter((b) => daysUntil(b.next_due_at) < 0);
    const dueSoon = active.filter((b) => {
      const d = daysUntil(b.next_due_at);
      return d >= 0 && d <= 7;
    });
    const later = active.filter((b) => daysUntil(b.next_due_at) > 7);
    return { overdue, dueSoon, later };
  }, [rows]);

  const createBill = async () => {
    const amt = defaultAmount.trim() === "" ? null : Number(defaultAmount);
    if (amt !== null && Number.isNaN(amt)) return alert("Amount must be a number");

    const intv = Number(interval);
    if (Number.isNaN(intv) || intv < 1) return alert("Interval must be >= 1");

    if (!name.trim()) return alert("Name is required");

    const { data, error } = await supabase.rpc("create_bill", {
      p_name: name.trim(),
      p_category: category.trim(),
      p_vendor: vendor.trim(),
      p_is_variable: isVariable,
      p_default_amount: amt,
      p_recurrence_freq: freq,
      p_recurrence_interval: intv,
      p_next_due_at: nextDue,
      p_autopay: autopay,
      p_notes: notes.trim(),
    });

    if (error) return alert(error.message);

    setOpenCreate(false);
    setName("");
    setVendor("");
    setCategory("");
    setIsVariable(false);
    setDefaultAmount("");
    setFreq("monthly");
    setInterval("1");
    setAutopay(false);
    setNotes("");

    await load();
    return data;
  };

  const Pill = ({ label, value }: { label: string; value: number }) => (
    <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs text-gray-200">
      {label}: <span className="font-semibold text-white">{value}</span>
    </span>
  );

  const BillCard = ({ b }: { b: BillRow }) => {
    const d = daysUntil(b.next_due_at);
    const badge =
      d < 0 ? `Overdue ${Math.abs(d)}d` : d === 0 ? "Due today" : `Due in ${d}d`;

    return (
      <Link
        href={`/app/bills/${b.id}`}
        className="block rounded-xl border border-white/20 bg-black p-3 hover:bg-white/5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{b.name}</div>
            <div className="mt-1 text-xs text-gray-400 flex flex-wrap gap-2">
              {b.vendor && <span>{b.vendor}</span>}
              {b.category && <span>• {b.category}</span>}
              <span>• {b.recurrence_freq}</span>
              {b.autopay && <span className="rounded-full border border-white/20 px-2 py-0.5">Autopay</span>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs text-gray-400">{b.next_due_at}</div>
            <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs ${
              d < 0 ? "bg-red-600/20 text-red-200" : d <= 7 ? "bg-yellow-600/20 text-yellow-200" : "bg-white/10 text-gray-200"
            }`}>
              {badge}
            </div>
          </div>
        </div>

        <div className="mt-2 text-sm text-gray-200">
          {b.is_variable ? (
            <span className="text-gray-400">Variable amount</span>
          ) : (
            <span>
              Default: <span className="font-semibold text-white">${Number(b.default_amount ?? 0).toFixed(2)}</span>
            </span>
          )}
        </div>
      </Link>
    );
  };

  if (loading) return <p className="p-6 text-white">Loading…</p>;

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Bills</h1>
        <button
          className="rounded-lg bg-white px-3 py-2 text-sm text-black"
          onClick={() => setOpenCreate(true)}
        >
          Add bill
        </button>
      </div>

      {err && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-600/10 p-3 text-sm text-red-200">
          {err}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Pill label="Overdue" value={buckets.overdue.length} />
        <Pill label="Due ≤ 7d" value={buckets.dueSoon.length} />
        <Pill label="Later" value={buckets.later.length} />
      </div>

      <h2 className="mt-5 text-lg font-semibold">Overdue</h2>
      <div className="mt-2 space-y-2">
        {buckets.overdue.length === 0 ? (
          <p className="text-sm text-gray-300">None 🎉</p>
        ) : (
          buckets.overdue.map((b) => <BillCard key={b.id} b={b} />)
        )}
      </div>

      <h2 className="mt-5 text-lg font-semibold">Due soon</h2>
      <div className="mt-2 space-y-2">
        {buckets.dueSoon.length === 0 ? (
          <p className="text-sm text-gray-300">None</p>
        ) : (
          buckets.dueSoon.map((b) => <BillCard key={b.id} b={b} />)
        )}
      </div>

      <h2 className="mt-5 text-lg font-semibold">Later</h2>
      <div className="mt-2 space-y-2">
        {buckets.later.length === 0 ? (
          <p className="text-sm text-gray-300">None</p>
        ) : (
          buckets.later.map((b) => <BillCard key={b.id} b={b} />)
        )}
      </div>

      {/* Create modal */}
      {openCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/20 bg-black p-4">
            <h2 className="text-lg font-semibold">Add bill</h2>

            <label className="mt-3 block text-sm text-gray-300">Name</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Rent"
            />

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm text-gray-300">Vendor</label>
                <input
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g., Landlord"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300">Category</label>
                <input
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g., utilities"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={isVariable}
                onChange={(e) => setIsVariable(e.target.checked)}
              />
              <span className="text-sm text-gray-200">Variable amount</span>
            </div>

            {!isVariable && (
              <>
                <label className="mt-3 block text-sm text-gray-300">Default amount</label>
                <input
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  value={defaultAmount}
                  onChange={(e) => setDefaultAmount(e.target.value)}
                  placeholder="e.g., 120.00"
                  inputMode="decimal"
                />
              </>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-sm text-gray-300">Frequency</label>
                <select
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  value={freq}
                  onChange={(e) => setFreq(e.target.value)}
                >
                  <option value="none">One-time</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-300">Every</label>
                <input
                  className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>

            <label className="mt-3 block text-sm text-gray-300">Next due date</label>
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
            />

            <div className="mt-3 flex items-center gap-2">
              <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
              <span className="text-sm text-gray-200">Autopay</span>
            </div>

            <label className="mt-3 block text-sm text-gray-300">Notes (optional)</label>
            <textarea
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-white/20 px-3 py-2 hover:bg-white/10"
                onClick={() => setOpenCreate(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-white px-3 py-2 text-black"
                onClick={createBill}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}