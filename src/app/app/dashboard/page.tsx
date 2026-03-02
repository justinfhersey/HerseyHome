"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type KPI = {
  week_total: number;
  month_total: number;
  year_total: number;
  month_food: number;
  month_nonfood: number;
};

type SeriesRow = {
  bucket_start: string; // date
  total: number;
  food: number;
  nonfood: number;
};

function money(n: number) {
  return `$${Number(n ?? 0).toFixed(2)}`;
}

function shortLabel(dateStr: string, grain: "week" | "month") {
  const d = new Date(dateStr + "T00:00:00");
  if (grain === "week") {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(d);
}

// Simple SVG bar chart (no deps)
function Bars({
  rows,
  height = 140,
  stacked = false,
}: {
  rows: { label: string; a: number; b?: number }[];
  height?: number;
  stacked?: boolean;
}) {
  const maxVal = useMemo(() => {
    if (rows.length === 0) return 1;
    const vals = rows.map((r) => (stacked ? r.a + (r.b ?? 0) : r.a));
    return Math.max(1, ...vals);
  }, [rows, stacked]);

  return (
    <div className="rounded-xl border border-white/20 bg-black p-3">
      <div className="flex items-end gap-2 overflow-x-auto pb-2">
        {rows.map((r, i) => {
          const aH = Math.round((r.a / maxVal) * height);
          const bH = Math.round(((r.b ?? 0) / maxVal) * height);
          const totalH = stacked ? aH + bH : aH;

          return (
            <div key={i} className="flex w-10 shrink-0 flex-col items-center gap-2">
              <div
                className="relative w-8 overflow-hidden rounded-md border border-white/10 bg-white/5"
                style={{ height }}
                title={stacked ? `${money(r.a)} food + ${money(r.b ?? 0)} non-food` : money(r.a)}
              >
                {/* base */}
                <div className="absolute inset-0" />

                {/* stacked bars: bottom = A, top = B */}
                {stacked ? (
                  <>
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-white"
                      style={{ height: aH }}
                    />
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-white/50"
                      style={{ height: totalH }}
                    />
                  </>
                ) : (
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-white"
                    style={{ height: aH }}
                  />
                )}
              </div>

              <div className="text-[11px] text-gray-400">{r.label}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 text-xs text-gray-400">
        {stacked ? (
          <div className="flex gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-white" /> Food
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-white/50" /> Non-food
            </span>
          </div>
        ) : (
          <span>Higher bar = more spending</span>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [householdId, setHouseholdId] = useState<string | null>(null);

  const [kpi, setKpi] = useState<KPI | null>(null);
  const [weekly, setWeekly] = useState<SeriesRow[]>([]);
  const [monthly, setMonthly] = useState<SeriesRow[]>([]);
  const [err, setErr] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr("");

    const { data: active, error: aErr } = await supabase.rpc("get_active_household");
    if (aErr) {
      setErr(aErr.message);
      setLoading(false);
      return;
    }
    if (!active) {
      setHouseholdId(null);
      setLoading(false);
      return;
    }
    setHouseholdId(active);

    const [{ data: kRows, error: kErr }, { data: wRows, error: wErr }, { data: mRows, error: mErr }] =
      await Promise.all([
        supabase.rpc("get_dashboard_kpis", { p_household_id: active }),
        supabase.rpc("get_spend_series", { p_household_id: active, p_grain: "week", p_points: 8 }),
        supabase.rpc("get_spend_series", { p_household_id: active, p_grain: "month", p_points: 12 }),
      ]);

    if (kErr) throw kErr;
    if (wErr) throw wErr;
    if (mErr) throw mErr;

    setKpi((kRows as any)?.[0] ?? null);
    setWeekly((wRows as any) ?? []);
    setMonthly((mRows as any) ?? []);

    setLoading(false);
  }

  useEffect(() => {
    load().catch((e) => {
      console.error(e);
      setErr(e.message ?? "Failed to load dashboard.");
      setLoading(false);
    });
  }, []);

  const weeklyBars = useMemo(
    () =>
      weekly.map((r) => ({
        label: shortLabel(r.bucket_start, "week"),
        a: Number(r.total ?? 0),
      })),
    [weekly]
  );

  const monthlyStacked = useMemo(
    () =>
      monthly.map((r) => ({
        label: shortLabel(r.bucket_start, "month"),
        a: Number(r.food ?? 0),
        b: Number(r.nonfood ?? 0),
      })),
    [monthly]
  );

  if (loading) return <p className="p-6 text-white">Loading…</p>;

  if (!householdId) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-white">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-gray-300">No active household selected.</p>
        <Link href="/app" className="mt-4 inline-block text-sm text-gray-300 hover:underline">
          ← Back
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <button
          onClick={load}
          className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      <div className="mt-3">
        <Link href="/app" className="text-sm text-gray-300 hover:underline">
          ← Back
        </Link>
      </div>

      {err && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-600/10 p-3 text-sm text-red-200">
          {err}
        </p>
      )}

      {/* KPI cards */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/20 bg-black p-4">
          <div className="text-xs text-gray-400">This week</div>
          <div className="mt-1 text-2xl font-semibold">{money(kpi?.week_total ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-white/20 bg-black p-4">
          <div className="text-xs text-gray-400">This month</div>
          <div className="mt-1 text-2xl font-semibold">{money(kpi?.month_total ?? 0)}</div>
          <div className="mt-2 text-xs text-gray-400">
            Food {money(kpi?.month_food ?? 0)} • Non-food {money(kpi?.month_nonfood ?? 0)}
          </div>
        </div>
        <div className="rounded-xl border border-white/20 bg-black p-4">
          <div className="text-xs text-gray-400">This year</div>
          <div className="mt-1 text-2xl font-semibold">{money(kpi?.year_total ?? 0)}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="mt-5 grid gap-4">
        <div>
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-lg font-semibold">Last 8 weeks</h2>
            <span className="text-xs text-gray-400">Total spend</span>
          </div>
          <Bars rows={weeklyBars} height={140} />
        </div>

        <div>
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-lg font-semibold">Last 12 months</h2>
            <span className="text-xs text-gray-400">Food vs Non-food</span>
          </div>
          <Bars rows={monthlyStacked} height={160} stacked />
        </div>
      </div>
    </main>
  );
}