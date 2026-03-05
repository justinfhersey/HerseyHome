"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Household = {
  id: string;
  name: string;
  role: string;
};

type TaskRow = {
  id: string;
  title: string;
  status: "open" | "done";
  due_at: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  kind: "todo" | "chore";
  priority: number;
  recurrence_freq: "none" | "daily" | "weekly" | "monthly";
  recurrence_interval: number;
};

type BillRow = {
  id: string;
  name: string;
  category: string | null;
  vendor: string | null;
  is_variable: boolean;
  default_amount: number | null;
  recurrence_freq: string;
  recurrence_interval: number;
  next_due_at: string; // YYYY-MM-DD
  autopay: boolean;
  is_active: boolean;
  created_at: string;
};

type ShoppingListRow = { id: string; name: string };

type ShoppingItemRow = {
  id: string;
  title: string;
  status: string;
  category: string | null;
  created_at: string;
};

function fmtDateShort(iso: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(iso)
  );
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysUntil(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = d.getTime() - start.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default function AppPage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<string | null>(null);

  // My Tasks widget state
  const [myTasksLoading, setMyTasksLoading] = useState(true);
  const [myTasks, setMyTasks] = useState<TaskRow[]>([]);
  const [myTasksErr, setMyTasksErr] = useState("");
  const [dueTodayCount, setDueTodayCount] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Bills Due Soon widget state (parked but kept)
  const [billsLoading, setBillsLoading] = useState(true);
  const [billsErr, setBillsErr] = useState("");
  const [bills, setBills] = useState<BillRow[]>([]);
  const [billsOverdueCount, setBillsOverdueCount] = useState(0);
  const [billsDueSoonCount, setBillsDueSoonCount] = useState(0);

  // Pay modal (parked but kept)
  const [payBill, setPayBill] = useState<BillRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paying, setPaying] = useState(false);

  // Shopping widget state
  const [shopLoading, setShopLoading] = useState(true);
  const [shopErr, setShopErr] = useState("");
  const [shoppingList, setShoppingList] = useState<ShoppingListRow | null>(null);
  const [shopItems, setShopItems] = useState<ShoppingItemRow[]>([]);
  const [shopOpenCount, setShopOpenCount] = useState(0);

  // Shopping quick add
  const [shopNewTitle, setShopNewTitle] = useState("");
  const [shopNewCategory, setShopNewCategory] = useState<"food" | "non-food">("food");
  const [shopAdding, setShopAdding] = useState(false);

  // Shopping checkoff modal (from widget)
  const [shopModalItem, setShopModalItem] = useState<ShoppingItemRow | null>(null);
  const [shopStore, setShopStore] = useState("");
  const [shopPrice, setShopPrice] = useState("");
  const [shopTaxRate, setShopTaxRate] = useState("");
  const [shopReceiptFile, setShopReceiptFile] = useState<File | null>(null);
  const [shopSavingPurchase, setShopSavingPurchase] = useState(false);

  async function loadHome() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      window.location.href = "/login";
      return;
    }

    setEmail(user.email ?? null);

    const { data: myHouseholds } = await supabase.rpc("my_households");
    setHouseholds(myHouseholds || []);

    const { data: active } = await supabase.rpc("get_active_household");
    setActiveHousehold(active || null);

    if (!active && myHouseholds && myHouseholds.length > 0) {
      await supabase.rpc("set_active_household", {
        p_household_id: myHouseholds[0].id,
      });
      setActiveHousehold(myHouseholds[0].id);
    }

    setLoading(false);
  }

  async function loadMyTasks() {
    setMyTasksLoading(true);
    setMyTasksErr("");

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;

    if (!uid) {
      setMyTasks([]);
      setDueTodayCount(0);
      setUnassignedCount(0);
      setMyTasksLoading(false);
      return;
    }

    const { data: rows, error } = await supabase.rpc("get_tasks_for_active_household");
    if (error) {
      setMyTasksErr(error.message);
      setMyTasks([]);
      setDueTodayCount(0);
      setUnassignedCount(0);
      setMyTasksLoading(false);
      return;
    }

    const list = ((rows as any) ?? []) as TaskRow[];
    const open = list.filter((t) => t.status === "open");

    setUnassignedCount(open.filter((t) => !t.assigned_to).length);

    const today = new Date();
    const mineOpen = open.filter((t) => t.assigned_to === uid);

    setDueTodayCount(
      mineOpen.filter((t) => t.due_at && isSameDay(new Date(t.due_at), today)).length
    );

    const nextUp = mineOpen
      .sort((a, b) => {
        const ad = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return (a.priority ?? 2) - (b.priority ?? 2);
      })
      .slice(0, 4);

    setMyTasks(nextUp);
    setMyTasksLoading(false);
  }

  async function loadBillsDueSoon() {
    setBillsLoading(true);
    setBillsErr("");

    const { data, error } = await supabase.rpc("get_bills_for_active_household");
    if (error) {
      setBillsErr(error.message);
      setBills([]);
      setBillsOverdueCount(0);
      setBillsDueSoonCount(0);
      setBillsLoading(false);
      return;
    }

    const list = (((data as any) ?? []) as BillRow[]).filter((b) => b.is_active);

    const overdue = list.filter((b) => daysUntil(b.next_due_at) < 0);
    const dueSoon = list.filter((b) => {
      const d = daysUntil(b.next_due_at);
      return d >= 0 && d <= 7;
    });

    setBillsOverdueCount(overdue.length);
    setBillsDueSoonCount(dueSoon.length);

    const widget = list
      .filter((b) => daysUntil(b.next_due_at) <= 7)
      .sort((a, b) => daysUntil(a.next_due_at) - daysUntil(b.next_due_at))
      .slice(0, 4);

    setBills(widget);
    setBillsLoading(false);
  }

  async function loadShoppingWidget() {
    setShopLoading(true);
    setShopErr("");

    try {
      const { data: hid, error: hErr } = await supabase.rpc("get_active_household");
      if (hErr) throw hErr;

      if (!hid) {
        setShoppingList(null);
        setShopItems([]);
        setShopOpenCount(0);
        setShopLoading(false);
        return;
      }

      const { data: lists, error: lErr } = await supabase
        .from("lists")
        .select("id,name")
        .eq("household_id", hid)
        .eq("type", "shopping")
        .limit(1);

      if (lErr) throw lErr;

      const list = (lists?.[0] as ShoppingListRow) ?? null;
      setShoppingList(list);

      if (!list) {
        setShopItems([]);
        setShopOpenCount(0);
        setShopLoading(false);
        return;
      }

      const { data: items, error: iErr } = await supabase.rpc("get_shopping_items", {
        p_list_id: list.id,
      });
      if (iErr) throw iErr;

      const all = ((items as any) ?? []) as ShoppingItemRow[];
      const open = all.filter((x) => x.status !== "purchased");

      setShopOpenCount(open.length);
      setShopItems(open.slice(0, 4));
      setShopLoading(false);
    } catch (e: any) {
      console.error(e);
      setShopErr(e.message ?? "Failed to load shopping list.");
      setShopItems([]);
      setShopOpenCount(0);
      setShopLoading(false);
    }
  }

  useEffect(() => {
    loadHome().catch((e) => console.error(e));
  }, []);

  useEffect(() => {
    loadMyTasks().catch((e) => {
      console.error(e);
      setMyTasksErr("Failed to load tasks.");
      setMyTasksLoading(false);
    });

    loadBillsDueSoon().catch((e) => {
      console.error(e);
      setBillsErr("Failed to load bills.");
      setBillsLoading(false);
    });

    loadShoppingWidget();
  }, [activeHousehold]);

  const switchHousehold = async (id: string) => {
    await supabase.rpc("set_active_household", { p_household_id: id });
    setActiveHousehold(id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const markDoneFromWidget = async (t: TaskRow) => {
    try {
      setMarkingId(t.id);

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;

      if (t.recurrence_freq && t.recurrence_freq !== "none") {
        const { error } = await supabase.rpc("complete_task", { p_task_id: t.id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("tasks")
          .update({
            status: "done",
            completed_at: new Date().toISOString(),
            completed_by: uid,
          })
          .eq("id", t.id);

        if (error) throw error;
      }

      await loadMyTasks();
    } catch (e: any) {
      alert(e.message ?? e.toString());
    } finally {
      setMarkingId(null);
    }
  };

  // Bills pay modal helpers (parked)
  const openPayModal = (b: BillRow) => {
    setPayBill(b);
    setPayAmount(b.is_variable ? "" : b.default_amount != null ? String(b.default_amount) : "");
    setPayNote("");
  };

  const confirmPay = async () => {
    if (!payBill) return;

    const amt = payAmount.trim() === "" ? null : Number(payAmount);
    if (amt == null || Number.isNaN(amt)) return alert("Enter a valid amount");

    setPaying(true);
    const { error } = await supabase.rpc("pay_bill", {
      p_bill_id: payBill.id,
      p_amount: amt,
      p_paid_at: new Date().toISOString(),
      p_note: payNote.trim(),
    });

    if (error) {
      setPaying(false);
      return alert(error.message);
    }

    setPaying(false);
    setPayBill(null);
    setPayAmount("");
    setPayNote("");
    await loadBillsDueSoon();
  };

  const quickAddShopping = async () => {
    if (!shoppingList) return alert("No shopping list found yet.");
    const title = shopNewTitle.trim();
    if (!title) return;

    setShopAdding(true);

    const { data: hid } = await supabase.rpc("get_active_household");
    if (!hid) {
      setShopAdding(false);
      return alert("No active household.");
    }

    const { error } = await supabase.from("list_items").insert({
      household_id: hid,
      list_id: shoppingList.id,
      title,
      status: "open",
      category: shopNewCategory,
    });

    if (error) {
      setShopAdding(false);
      return alert(error.message);
    }

    setShopNewTitle("");
    setShopAdding(false);
    await loadShoppingWidget();
  };

  const uploadReceiptToPath = async (path: string, file: File) => {
    const { error } = await supabase.storage.from("receipts").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
  };

  const openShopCheckoff = (it: ShoppingItemRow) => {
    setShopModalItem(it);
    setShopStore("");
    setShopPrice("");
    setShopTaxRate("");
    setShopReceiptFile(null);
  };

  const confirmShopPurchase = async () => {
    if (!shopModalItem) return;

    setShopSavingPurchase(true);

    try {
      const { data: hid, error: hErr } = await supabase.rpc("get_active_household");
      if (hErr) throw hErr;
      if (!hid) throw new Error("No active household selected.");

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;

      const priceNum = shopPrice.trim() === "" ? null : Number(shopPrice);
      if (priceNum === null || Number.isNaN(priceNum)) throw new Error("Enter a valid price.");
      if (priceNum < 0) throw new Error("Price cannot be negative.");

      const taxRateNum = shopTaxRate.trim() === "" ? 0 : Number(shopTaxRate);
      if (Number.isNaN(taxRateNum)) throw new Error("Tax % must be a number.");
      if (taxRateNum < 0 || taxRateNum > 25) throw new Error("Tax % looks off (try 0–25).");

      const storeVal = shopStore.trim() === "" ? null : shopStore.trim();

      const cat = (shopModalItem.category ?? "food").toLowerCase();
      const isFood = cat === "food";
      const foodRate = isFood ? taxRateNum : 0;
      const salesRate = !isFood ? taxRateNum : 0;

      const taxTotal = round2(priceNum * (taxRateNum / 100));
      const total = round2(priceNum + taxTotal);

      const { data: receipt, error: rErr } = await supabase
        .from("receipts")
        .insert({
          household_id: hid,
          created_by: uid,
          store: storeVal,
          food_tax_rate: foodRate,
          sales_tax_rate: salesRate,
          subtotal: priceNum,
          tax_total: taxTotal,
          total: total,
        })
        .select("id")
        .single();

      if (rErr) throw rErr;

      if (shopReceiptFile) {
        const ext =
          shopReceiptFile.name.split(".").pop()?.toLowerCase() ||
          (shopReceiptFile.type.includes("png") ? "png" : "jpg");
        const imagePath = `${hid}/${receipt.id}/${crypto.randomUUID()}.${ext}`;

        await uploadReceiptToPath(imagePath, shopReceiptFile);

        const { error: upErr } = await supabase
          .from("receipts")
          .update({ image_path: imagePath })
          .eq("id", receipt.id);

        if (upErr) throw upErr;
      }

      const { error: uErr } = await supabase
        .from("list_items")
        .update({
          status: "purchased",
          purchased_at: new Date().toISOString(),
          purchased_by: uid,
          store: storeVal,
          price: priceNum,
          tax: taxTotal,
          receipt_id: receipt.id,
        })
        .eq("id", shopModalItem.id);

      if (uErr) throw uErr;

      setShopModalItem(null);
      setShopStore("");
      setShopPrice("");
      setShopTaxRate("");
      setShopReceiptFile(null);

      await loadShoppingWidget();
      await loadBillsDueSoon(); // in case you want totals refreshed
    } catch (e: any) {
      alert(e.message ?? e.toString());
    } finally {
      setShopSavingPurchase(false);
    }
  };

  const Pill = ({ label, value }: { label: string; value: number }) => (
    <span className="rounded-full border px-2 py-0.5 text-xs text-gray-700">
      {label}: <span className="font-semibold">{value}</span>
    </span>
  );

  if (loading) return <p className="p-6">Loading…</p>;

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Hersey Home</h1>
      <p className="mt-2 text-sm text-gray-600">Signed in as {email}</p>

      {households.length === 0 && (
        <div className="mt-6">
          <p>No household yet.</p>
          <Link
            href="/app/onboarding"
            className="mt-2 inline-block rounded-lg bg-black px-4 py-2 text-white"
          >
            Create Household
          </Link>
        </div>
      )}

      {households.length > 0 && (
        <div className="mt-6">
          <label className="text-sm font-medium">Active Household</label>
          <select
            value={activeHousehold ?? ""}
            onChange={(e) => switchHousehold(e.target.value)}
            className="mt-2 block w-full rounded-lg border px-3 py-2"
          >
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.role})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* My Tasks widget */}
      <section className="mt-6 rounded-xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">My Tasks</h2>
            <p className="text-sm text-gray-600">Assigned to you • next up</p>

            <div className="mt-2 flex flex-wrap gap-2">
              <Pill label="Due today" value={dueTodayCount} />
              <Pill label="Unassigned" value={unassignedCount} />
              <Pill label="Showing" value={myTasks.length} />
            </div>
          </div>

          <div className="flex gap-2">
            <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => loadMyTasks()}>
              Refresh
            </button>
            <Link href="/app/tasks" className="rounded-lg bg-black px-3 py-2 text-white text-sm">
              Open Tasks
            </Link>
          </div>
        </div>

        {myTasksLoading ? (
          <p className="mt-3 text-sm text-gray-600">Loading…</p>
        ) : myTasksErr ? (
          <p className="mt-3 text-sm text-red-600">{myTasksErr}</p>
        ) : myTasks.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">No open tasks assigned to you 🎉</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {myTasks.map((t) => (
              <li key={t.id} className="rounded-lg border px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.title}</div>

                    <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-2">
                      <span className="rounded-full border px-2 py-0.5">
                        {t.kind === "chore" ? "Chore" : "To-do"}
                      </span>
                      <span className="rounded-full border px-2 py-0.5">
                        {t.priority === 1 ? "High" : t.priority === 3 ? "Low" : "Normal"}
                      </span>
                      {t.due_at ? (
                        <span className="rounded-full border px-2 py-0.5">
                          Due {fmtDateShort(t.due_at)}
                        </span>
                      ) : (
                        <span className="rounded-full border px-2 py-0.5">No due date</span>
                      )}
                      {t.recurrence_freq !== "none" && (
                        <span className="rounded-full border px-2 py-0.5">Recurring</span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col gap-2">
                    <button
                      className="rounded-lg bg-black px-3 py-2 text-white text-sm disabled:opacity-60"
                      disabled={markingId === t.id}
                      onClick={() => markDoneFromWidget(t)}
                    >
                      {markingId === t.id ? "Marking…" : "Mark done"}
                    </button>

                    <Link
                      href="/app/tasks"
                      className="text-sm text-gray-700 hover:underline text-right"
                    >
                      View
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 text-xs text-gray-500">
          Showing up to 4 upcoming tasks assigned to you.
        </div>
      </section>

      {/* Bills Due Soon widget (restored) */}
      <section className="mt-6 rounded-xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Bills Due Soon</h2>
            <p className="text-sm text-gray-600">Next 7 days • quick pay</p>

            <div className="mt-2 flex flex-wrap gap-2">
              <Pill label="Overdue" value={billsOverdueCount} />
              <Pill label="Due soon" value={billsDueSoonCount} />
              <Pill label="Showing" value={bills.length} />
            </div>
          </div>

          <div className="flex gap-2">
            <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => loadBillsDueSoon()}>
              Refresh
            </button>
            <Link href="/app/bills" className="rounded-lg bg-black px-3 py-2 text-white text-sm">
              Open Bills
            </Link>
          </div>
        </div>

        {billsLoading ? (
          <p className="mt-3 text-sm text-gray-600">Loading…</p>
        ) : billsErr ? (
          <p className="mt-3 text-sm text-red-600">{billsErr}</p>
        ) : bills.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">No bills due in the next 7 days 🎉</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {bills.map((b) => {
              const d = daysUntil(b.next_due_at);
              const label = d < 0 ? `Overdue (${Math.abs(d)}d)` : d === 0 ? "Due today" : `Due in ${d}d`;

              return (
                <li key={b.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{b.name}</div>

                      <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-2">
                        <span className="rounded-full border px-2 py-0.5">{label}</span>
                        <span className="rounded-full border px-2 py-0.5">
                          Due {fmtDateShort(b.next_due_at)}
                        </span>
                        {b.autopay && <span className="rounded-full border px-2 py-0.5">Autopay</span>}
                        {b.is_variable && <span className="rounded-full border px-2 py-0.5">Variable</span>}
                        {!b.is_variable && b.default_amount != null && (
                          <span className="rounded-full border px-2 py-0.5">
                            ${Number(b.default_amount).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-col gap-2">
                      <button
                        className="rounded-lg bg-black px-3 py-2 text-white text-sm"
                        onClick={() => openPayModal(b)}
                      >
                        Pay
                      </button>
                      <Link href="/app/bills" className="text-sm text-gray-700 hover:underline text-right">
                        View
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 text-xs text-gray-500">Showing up to 4 bills due within 7 days.</div>
      </section>

      {/* Shopping List widget */}
      <section className="mt-6 rounded-xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Shopping List</h2>
            <p className="text-sm text-gray-600">Quick view + quick add</p>

            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border px-2 py-0.5 text-xs text-gray-700">
                Open: <span className="font-semibold">{shopOpenCount}</span>
              </span>
              {shoppingList?.name && (
                <span className="rounded-full border px-2 py-0.5 text-xs text-gray-700">
                  List: <span className="font-semibold">{shoppingList.name}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button className="rounded-lg border px-3 py-2 text-sm" onClick={loadShoppingWidget}>
              Refresh
            </button>
            <Link href="/app/shopping" className="rounded-lg bg-black px-3 py-2 text-white text-sm">
              Open Shopping
            </Link>
          </div>
        </div>

        {shopLoading ? (
          <p className="mt-3 text-sm text-gray-600">Loading…</p>
        ) : shopErr ? (
          <p className="mt-3 text-sm text-red-600">{shopErr}</p>
        ) : !shoppingList ? (
          <p className="mt-3 text-sm text-gray-600">No shopping list found for this household.</p>
        ) : (
          <>
            {/* Quick Add */}
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <input
                className="sm:col-span-2 w-full rounded-lg border px-3 py-2"
                value={shopNewTitle}
                onChange={(e) => setShopNewTitle(e.target.value)}
                placeholder="Quick add item (e.g., milk)"
                onKeyDown={(e) => e.key === "Enter" && quickAddShopping()}
              />

              <select
                className="w-full rounded-lg border px-3 py-2"
                value={shopNewCategory}
                onChange={(e) => setShopNewCategory(e.target.value as any)}
              >
                <option value="food">Food</option>
                <option value="non-food">Non-Food</option>
              </select>

              <button
                className="rounded-lg bg-black px-3 py-2 text-white disabled:opacity-60"
                onClick={quickAddShopping}
                disabled={shopAdding}
              >
                {shopAdding ? "Adding…" : "Add"}
              </button>
            </div>

            {/* Items preview */}
            {shopItems.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">No open items 🎉</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {shopItems.map((it) => (
                  <li key={it.id} className="rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{it.title}</div>
                        <div className="mt-1 text-xs text-gray-600">
                          {it.category ? `Category: ${it.category}` : "Category: —"}
                        </div>
                      </div>

                      <div className="shrink-0 flex gap-2">
                        <button
                          className="rounded-lg bg-black px-3 py-2 text-white text-sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openShopCheckoff(it);
                          }}
                        >
                          Check off
                        </button>

                        <Link
                          href="/app/shopping/list"
                          className="rounded-lg border px-3 py-2 text-sm hover:bg-black/5"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 text-xs text-gray-500">Showing up to 4 open items.</div>
          </>
        )}
      </section>

      {/* Primary buttons */}
      <div className="mt-8 flex gap-3 flex-wrap">
        <a href="/app/shopping" className="rounded-lg bg-black px-4 py-2 text-white">
          Shopping
        </a>

        <a href="/app/tasks" className="rounded-lg bg-black px-4 py-2 text-white">
          Tasks
        </a>

        <a href="/app/bills" className="rounded-lg bg-black px-4 py-2 text-white">
          Bills
        </a>

        <a href="/app/dashboard" className="rounded-lg bg-black px-4 py-2 text-white">
          Dashboard
        </a>

        <button onClick={signOut} className="rounded-lg bg-black px-4 py-2 text-white">
          Sign out
        </button>
      </div>

      {/* Shopping checkoff modal */}
      {shopModalItem && (() => {
        const cat = (shopModalItem.category ?? "food").toLowerCase();
        const isFood = cat === "food";
        const taxLabel = isFood ? "Food Tax %" : "Sales Tax %";

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-4 text-black">
              <h2 className="text-lg font-semibold">Check off “{shopModalItem.title}”</h2>

              <label className="mt-3 block text-sm">Purchased From</label>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={shopStore}
                onChange={(e) => setShopStore(e.target.value)}
                placeholder="e.g., Walmart"
              />

              <label className="mt-3 block text-sm">Price</label>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={shopPrice}
                onChange={(e) => setShopPrice(e.target.value)}
                placeholder="e.g., 4.99"
                inputMode="decimal"
              />

              <label className="mt-3 block text-sm">{taxLabel}</label>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={shopTaxRate}
                onChange={(e) => setShopTaxRate(e.target.value)}
                placeholder="e.g., 7"
                inputMode="decimal"
              />

              <label className="mt-3 block text-sm">Receipt photo (optional)</label>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setShopReceiptFile(e.target.files?.[0] ?? null)}
              />

              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="rounded-lg border px-3 py-2"
                  onClick={() => {
                    setShopModalItem(null);
                    setShopReceiptFile(null);
                  }}
                  disabled={shopSavingPurchase}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-black px-3 py-2 text-white disabled:opacity-60"
                  onClick={confirmShopPurchase}
                  disabled={shopSavingPurchase}
                >
                  {shopSavingPurchase ? "Saving…" : "Save & Check off"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bills pay modal (parked) */}
      {payBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-white p-4 text-black">
            <h2 className="text-lg font-semibold">Pay “{payBill.name}”</h2>
            <p className="mt-1 text-sm text-gray-600">
              Due {payBill.next_due_at}
              {payBill.is_variable
                ? ""
                : payBill.default_amount != null
                ? ` • Default $${Number(payBill.default_amount).toFixed(2)}`
                : ""}
            </p>

            <label className="mt-3 block text-sm">Amount</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder={payBill.is_variable ? "e.g., 83.21" : "Leave as default"}
              inputMode="decimal"
            />

            <label className="mt-3 block text-sm">Note (optional)</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="e.g., paid via checking"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border px-3 py-2"
                onClick={() => {
                  setPayBill(null);
                  setPayAmount("");
                  setPayNote("");
                }}
                disabled={paying}
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-black px-3 py-2 text-white disabled:opacity-60"
                onClick={confirmPay}
                disabled={paying}
              >
                {paying ? "Saving…" : "Mark paid"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
