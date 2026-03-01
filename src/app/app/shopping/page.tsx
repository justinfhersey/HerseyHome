"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ListRow = { id: string; name: string };

type ItemRow = {
  id: string;
  title: string;
  status: string;

  category: string | null;
  store: string | null;

  purchased_by: string | null;
  purchased_by_name: string | null;

  purchased_at: string | null;
  price: number | null; // base price
  tax: number | null;   // allocated tax amount

  receipt_id: string | null;
  receipt_image_path: string | null;

  created_at: string;
};

type SpendingSummary = {
  week_total: number;
  month_total: number;
  year_total: number;
  month_food: number;
  month_nonfood: number;
};

const CATEGORY_OPTIONS = [
  { value: "food", label: "Food" },
  { value: "non-food", label: "Non-Food" },
];

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getReceiptPublicUrl(path: string) {
  const { data } = supabase.storage.from("receipts").getPublicUrl(path);
  return data.publicUrl;
}

// Allocate tax across items by price, in cents, so the sum matches exactly.
function allocateTaxByPrice(prices: number[], taxRatePct: number) {
  const priceCents = prices.map((p) => Math.round(p * 100));
  const subtotalCents = priceCents.reduce((a, b) => a + b, 0);

  const taxTotalCents = Math.round(subtotalCents * (taxRatePct / 100));

  if (subtotalCents === 0) {
    // If all prices are 0, just split tax evenly (or all zero)
    const per = Math.floor(taxTotalCents / prices.length);
    const rem = taxTotalCents - per * prices.length;
    const taxes = prices.map((_, i) => (per + (i < rem ? 1 : 0)) / 100);
    return { taxes, taxTotal: taxTotalCents / 100, subtotal: 0, total: taxTotalCents / 100 };
  }

  // raw proportional allocations (float cents)
  const raw = priceCents.map((pc) => (pc / subtotalCents) * taxTotalCents);

  // floor all, track remainder
  const floored = raw.map((x) => Math.floor(x));
  let used = floored.reduce((a, b) => a + b, 0);
  let remainder = taxTotalCents - used;

  // distribute remaining cents to the items with largest fractional part
  const fracs = raw.map((x, i) => ({ i, frac: x - Math.floor(x) }));
  fracs.sort((a, b) => b.frac - a.frac);

  const taxesCents = [...floored];
  for (let k = 0; k < fracs.length && remainder > 0; k++) {
    taxesCents[fracs[k].i] += 1;
    remainder -= 1;
  }

  const taxes = taxesCents.map((c) => c / 100);
  const subtotal = subtotalCents / 100;
  const taxTotal = taxTotalCents / 100;
  const total = round2(subtotal + taxTotal);

  return { taxes, subtotal, taxTotal, total };
}

export default function ShoppingPage() {
  const [loading, setLoading] = useState(true);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [shoppingList, setShoppingList] = useState<ListRow | null>(null);

  const [items, setItems] = useState<ItemRow[]>([]);
  const [summary, setSummary] = useState<SpendingSummary | null>(null);

  // quick-add
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState<string>("food");
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const [adding, setAdding] = useState(false);

  // purchase/edit modal (single item)
  const [modalItem, setModalItem] = useState<ItemRow | null>(null);
  const [modalMode, setModalMode] = useState<"checkoff" | "edit">("checkoff");
  const [store, setStore] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [taxRate, setTaxRate] = useState<string>("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // delete confirm modal
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [deleteItemTitle, setDeleteItemTitle] = useState<string>("");

  // receipt mode (multi-select)
  const [receiptMode, setReceiptMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);

  // receipt modal fields
  const [receiptStore, setReceiptStore] = useState("");
  const [receiptTaxRate, setReceiptTaxRate] = useState("");
  const [receiptPhoto, setReceiptPhoto] = useState<File | null>(null);
  const [receiptPrices, setReceiptPrices] = useState<Record<string, string>>({}); // id -> price string

  const checkedTotalOnScreen = useMemo(() => {
    return items.reduce((acc, it) => {
      if (it.status !== "purchased") return acc;
      return acc + Number(it.price ?? 0) + Number(it.tax ?? 0);
    }, 0);
  }, [items]);

  async function load() {
    setLoading(true);

    const { data: active, error: aErr } = await supabase.rpc("get_active_household");
    if (aErr) throw aErr;

    if (!active) {
      setHouseholdId(null);
      setShoppingList(null);
      setItems([]);
      setSummary(null);
      setLoading(false);
      return;
    }

    setHouseholdId(active);

    const { data: lists, error: lErr } = await supabase
      .from("lists")
      .select("id,name")
      .eq("household_id", active)
      .eq("type", "shopping")
      .limit(1);

    if (lErr) throw lErr;

    const list = (lists?.[0] as ListRow) ?? null;
    setShoppingList(list);

    if (list) {
      const { data: iRows, error: iErr } = await supabase.rpc("get_shopping_items", {
        p_list_id: list.id,
      });
      if (iErr) throw iErr;
      setItems((iRows as any) ?? []);
    } else {
      setItems([]);
    }

    const { data: sRows, error: sErr } = await supabase.rpc("get_spending_summary", {
      p_household_id: active,
    });
    if (sErr) throw sErr;
    setSummary((sRows as any)?.[0] ?? null);

    setLoading(false);
  }

  useEffect(() => {
    load().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, []);

  const addItem = async () => {
    if (!shoppingList || !householdId) return;

    const title = newTitle.trim();
    if (!title) return;

    setAdding(true);

    // optimistic add
    const tempId = crypto.randomUUID();
    setItems((prev) => [
      {
        id: tempId,
        title,
        status: "open",
        category: newCategory,
        store: null,

        purchased_by: null,
        purchased_by_name: null,
        purchased_at: null,
        price: null,
        tax: null,

        receipt_id: null,
        receipt_image_path: null,

        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    setNewTitle("");

    const { error: insertError } = await supabase.from("list_items").insert({
      household_id: householdId,
      list_id: shoppingList.id,
      title,
      status: "open",
      category: newCategory,
    });

    if (insertError) {
      alert(insertError.message);
      setItems((prev) => prev.filter((x) => x.id !== tempId));
      setAdding(false);
      return;
    }

    await load();
    setAdding(false);
    addInputRef.current?.focus();
  };

  // single-item checkoff/edit
  const openCheckoff = (it: ItemRow) => {
    setModalMode("checkoff");
    setModalItem(it);
    setStore(it.store ?? "");
    setPrice(it.price?.toString() ?? "");
    setTaxRate("");
    setReceiptFile(null);
  };

  const openEditPurchase = (it: ItemRow) => {
    setModalMode("edit");
    setModalItem(it);
    setStore(it.store ?? "");
    setPrice(it.price?.toString() ?? "");
    // derive tax % from stored amounts if possible
    const p = Number(it.price ?? 0);
    const t = Number(it.tax ?? 0);
    const pct = p > 0 ? round2((t / p) * 100) : 0;
    setTaxRate(pct ? pct.toString() : "");
    setReceiptFile(null);
  };

  const uploadReceiptToPath = async (path: string, file: File) => {
    const { error } = await supabase.storage.from("receipts").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
  };

  const confirmPurchaseSingle = async () => {
    if (!modalItem || !householdId) return;

    const storeVal = store.trim() === "" ? null : store.trim();

    const priceNum = price.trim() === "" ? null : Number(price);
    if (priceNum !== null && Number.isNaN(priceNum)) return alert("Price must be a number");
    if (priceNum !== null && priceNum < 0) return alert("Price cannot be negative");

    const taxRateNum = taxRate.trim() === "" ? 0 : Number(taxRate);
    if (Number.isNaN(taxRateNum)) return alert("Tax % must be a number");
    if (taxRateNum < 0 || taxRateNum > 25) return alert("Tax % looks off (try 0–25).");

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;

    const subtotal = priceNum ?? 0;
    const taxTotal = priceNum === null ? null : round2(subtotal * (taxRateNum / 100));
    const total = priceNum === null ? null : round2(subtotal + (taxTotal ?? 0));

    // Create a receipt row even for single item so everything is consistent
    const { data: receipt, error: rErr } = await supabase
      .from("receipts")
      .insert({
        household_id: householdId,
        created_by: uid,
        store: storeVal,
        tax_rate: taxRateNum,
        subtotal: subtotal,
        tax_total: taxTotal ?? 0,
        total: total ?? 0,
      })
      .select("id")
      .single();

    if (rErr) return alert(rErr.message);

    let imagePath: string | null = null;
    if (receiptFile) {
      const ext =
        receiptFile.name.split(".").pop()?.toLowerCase() ||
        (receiptFile.type.includes("png") ? "png" : "jpg");
      imagePath = `${householdId}/${receipt.id}/${crypto.randomUUID()}.${ext}`;

      try {
        await uploadReceiptToPath(imagePath, receiptFile);
        await supabase.from("receipts").update({ image_path: imagePath }).eq("id", receipt.id);
      } catch (e: any) {
        alert(`Receipt upload failed: ${e.message ?? e.toString()}`);
      }
    }

    const { error } = await supabase
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
      .eq("id", modalItem.id);

    if (error) alert(error.message);

    setModalItem(null);
    setStore("");
    setPrice("");
    setTaxRate("");
    setReceiptFile(null);

    await load();
    addInputRef.current?.focus();
  };

  // delete
  const requestDelete = (it: ItemRow) => {
    setDeleteItemId(it.id);
    setDeleteItemTitle(it.title);
  };

  const confirmDelete = async () => {
    if (!deleteItemId) return;

    const prev = items;
    setItems((p) => p.filter((x) => x.id !== deleteItemId));

    const { error } = await supabase.from("list_items").delete().eq("id", deleteItemId);

    if (error) {
      alert(error.message);
      setItems(prev);
    } else {
      await load();
    }

    setDeleteItemId(null);
    setDeleteItemTitle("");
  };

  // receipt mode helpers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = useMemo(() => {
    const set = selectedIds;
    return items.filter((it) => set.has(it.id));
  }, [items, selectedIds]);

  const openReceiptModal = () => {
    if (selectedItems.length === 0) return;

    // Prefill prices with existing price if present, else empty
    const nextPrices: Record<string, string> = {};
    for (const it of selectedItems) {
      nextPrices[it.id] = it.price != null ? String(it.price) : "";
    }
    setReceiptPrices(nextPrices);

    setReceiptStore("");
    setReceiptTaxRate("");
    setReceiptPhoto(null);
    setReceiptModalOpen(true);
  };

  const receiptComputed = useMemo(() => {
    const taxPct = receiptTaxRate.trim() === "" ? 0 : Number(receiptTaxRate);
    if (Number.isNaN(taxPct)) return null;

    // parse all prices; require all filled and valid
    const prices: number[] = [];
    for (const it of selectedItems) {
      const raw = (receiptPrices[it.id] ?? "").trim();
      if (raw === "") return null;
      const p = Number(raw);
      if (Number.isNaN(p) || p < 0) return null;
      prices.push(p);
    }

    const { taxes, subtotal, taxTotal, total } = allocateTaxByPrice(prices, taxPct);
    return { prices, taxes, subtotal, taxTotal, total, taxPct };
  }, [receiptPrices, receiptTaxRate, selectedItems]);

  const confirmAttachReceipt = async () => {
    if (!householdId) return;
    if (selectedItems.length === 0) return alert("Select at least one item.");

    const computed = receiptComputed;
    if (!computed) return alert("Enter a valid price for each selected item and a valid tax %.");

    if (!receiptPhoto) return alert("Please select a receipt photo.");

    const storeVal = receiptStore.trim() === "" ? null : receiptStore.trim();

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;

    // 1) Create receipt row
    const { data: receipt, error: rErr } = await supabase
      .from("receipts")
      .insert({
        household_id: householdId,
        created_by: uid,
        store: storeVal,
        tax_rate: computed.taxPct,
        subtotal: computed.subtotal,
        tax_total: computed.taxTotal,
        total: computed.total,
      })
      .select("id")
      .single();

    if (rErr) return alert(rErr.message);

    // 2) Upload receipt photo once
    const ext =
      receiptPhoto.name.split(".").pop()?.toLowerCase() ||
      (receiptPhoto.type.includes("png") ? "png" : "jpg");
    const imagePath = `${householdId}/${receipt.id}/${crypto.randomUUID()}.${ext}`;

    try {
      await uploadReceiptToPath(imagePath, receiptPhoto);
      const { error: upErr } = await supabase
        .from("receipts")
        .update({ image_path: imagePath })
        .eq("id", receipt.id);
      if (upErr) throw upErr;
    } catch (e: any) {
      alert(`Receipt upload failed: ${e.message ?? e.toString()}`);
      return;
    }

    // 3) Update each item: mark purchased + set allocated tax + link receipt
    // Ensure rounding + allocation aligns with items order
    for (let i = 0; i < selectedItems.length; i++) {
      const it = selectedItems[i];
      const p = computed.prices[i];
      const t = computed.taxes[i];

      const { error } = await supabase
        .from("list_items")
        .update({
          status: "purchased",
          purchased_at: new Date().toISOString(),
          purchased_by: uid,
          store: storeVal,
          price: p,
          tax: t,
          receipt_id: receipt.id,
        })
        .eq("id", it.id);

      if (error) {
        alert(`Failed updating ${it.title}: ${error.message}`);
        // continue attempting others
      }
    }

    // cleanup
    setReceiptModalOpen(false);
    setReceiptMode(false);
    setSelectedIds(new Set());
    setReceiptPhoto(null);
    setReceiptStore("");
    setReceiptTaxRate("");
    setReceiptPrices({});

    await load();
  };

  if (loading) return <p className="p-6 text-white">Loading…</p>;
  if (!householdId)
    return <p className="p-6 text-white">No active household selected. Go back and pick one.</p>;
  if (!shoppingList) {
    return (
      <main className="p-6 text-white">
        <h1 className="text-2xl font-semibold">Shopping</h1>
        <p className="mt-2">No Shopping list found for this household.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 text-white">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Shopping</h1>

        <button
          className={`rounded-lg border px-3 py-2 text-sm ${
            receiptMode ? "border-white/40 bg-white/10" : "border-white/20 hover:bg-white/10"
          }`}
          onClick={() => {
            setReceiptMode((v) => !v);
            setSelectedIds(new Set());
          }}
        >
          {receiptMode ? "Receipt mode: ON" : "Receipt mode"}
        </button>
      </div>

      {/* Spending Summary */}
      <div className="mt-3 rounded-xl border border-white/20 p-3 text-sm">
        <div className="font-medium">Spending Summary</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-5">
          <div>
            <div className="text-gray-400">This week</div>
            <div className="font-semibold">${Number(summary?.week_total ?? 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-400">This month</div>
            <div className="font-semibold">${Number(summary?.month_total ?? 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-400">This year</div>
            <div className="font-semibold">${Number(summary?.year_total ?? 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-400">Month (Food)</div>
            <div className="font-semibold">${Number(summary?.month_food ?? 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-gray-400">Month (Non-Food)</div>
            <div className="font-semibold">${Number(summary?.month_nonfood ?? 0).toFixed(2)}</div>
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-400">
          (On-screen checked total: ${checkedTotalOnScreen.toFixed(2)})
        </div>
      </div>

      {/* Items */}
      <ul className="mt-4 space-y-3 pb-28 sm:pb-6">
        {items.map((it) => {
          const selected = selectedIds.has(it.id);
          const receiptUrl = it.receipt_image_path ? getReceiptPublicUrl(it.receipt_image_path) : null;

          return (
            <li
              key={it.id}
              className={`rounded-xl border p-3 bg-black ${
                selected ? "border-white/60" : "border-white/20"
              }`}
              onClick={() => {
                if (!receiptMode) return;
                // Only allow selecting OPEN items for receipt mode
                if (it.status === "purchased") return;
                toggleSelect(it.id);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {receiptMode && it.status !== "purchased" && (
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
                          selected ? "border-white/80 bg-white text-black" : "border-white/30"
                        }`}
                      >
                        {selected ? "✓" : ""}
                      </span>
                    )}

                    <div className={it.status === "purchased" ? "line-through opacity-60" : ""}>
                      {it.title}
                    </div>
                  </div>

                  <div className="mt-1 text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-1">
                    {it.category && <span>Category: {it.category}</span>}
                    {it.store && <span>Purchased from: {it.store}</span>}
                  </div>

                  {it.status === "purchased" && (
                    <div className="mt-1 text-xs text-gray-400">
                      Purchased by{" "}
                      <span className="font-medium">{it.purchased_by_name ?? "Member"}</span> • $
                      {Number(it.price ?? 0).toFixed(2)} + tax ${Number(it.tax ?? 0).toFixed(2)} ={" "}
                      <span className="font-medium">
                        ${(Number(it.price ?? 0) + Number(it.tax ?? 0)).toFixed(2)}
                      </span>{" "}
                      <span className="text-gray-500">(tap to edit)</span>
                    </div>
                  )}

                  {receiptUrl && (
                    <div className="mt-2">
                      <img
                        src={receiptUrl}
                        alt="Receipt"
                        className="h-16 w-16 rounded-md object-cover border border-white/20"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          window.open(receiptUrl, "_blank");
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {!receiptMode && it.status !== "purchased" ? (
                    <button
                      className="rounded-lg border border-white/30 px-4 py-2 text-sm text-white hover:bg-white/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCheckoff(it);
                      }}
                    >
                      Check off
                    </button>
                  ) : it.status === "purchased" ? (
                    <button
                      className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditPurchase(it);
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500 self-end">
                      {receiptMode ? "Tap to select" : ""}
                    </span>
                  )}

                  {!receiptMode && (
                    <button
                      className="rounded-lg border border-red-400/50 px-4 py-2 text-sm text-red-200 hover:bg-red-600/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(it);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Sticky bottom bar:
          - normal quick-add when NOT in receipt mode
          - receipt actions when receipt mode ON
      */}
      <div className="fixed inset-x-0 bottom-0 border-t border-white/20 bg-black p-3 sm:static sm:border-0 sm:p-0">
        <div className="mx-auto max-w-3xl">
          {!receiptMode ? (
            <div className="grid gap-2 sm:grid-cols-4">
              <input
                ref={addInputRef}
                className="sm:col-span-2 rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white placeholder:text-gray-600"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add item (e.g., milk)"
                onKeyDown={(e) => e.key === "Enter" && addItem()}
              />

              <select
                className="rounded-lg border border-white/20 bg-black px-3 py-3 text-base text-white"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>

              <button
                className="rounded-lg bg-white px-4 py-3 text-base text-black disabled:opacity-60"
                onClick={addItem}
                disabled={adding}
              >
                {adding ? "Adding..." : "Add"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-gray-300">
                Selected: <span className="font-semibold text-white">{selectedItems.length}</span>
              </div>

              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                  onClick={() => {
                    setReceiptMode(false);
                    setSelectedIds(new Set());
                  }}
                >
                  Cancel
                </button>

                <button
                  className="rounded-lg bg-white px-3 py-2 text-sm text-black disabled:opacity-60"
                  disabled={selectedItems.length === 0}
                  onClick={openReceiptModal}
                >
                  Attach receipt
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Single-item Checkoff/Edit modal */}
      {modalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-black p-4 text-white border border-white/20">
            <h2 className="text-lg font-semibold">
              {modalMode === "checkoff" ? "Check off" : "Edit purchase"} “{modalItem.title}”
            </h2>

            <label className="mt-3 block text-sm text-gray-300">Purchased From</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="e.g., Walmart"
            />

            <label className="mt-3 block text-sm text-gray-300">Price</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g., 4.99"
              inputMode="decimal"
            />

            <label className="mt-3 block text-sm text-gray-300">Tax %</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              placeholder="e.g., 7"
              inputMode="decimal"
            />

            <label className="mt-3 block text-sm text-gray-300">Receipt photo (optional)</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-white/20 px-3 py-2 hover:bg-white/10"
                onClick={() => {
                  setModalItem(null);
                  setReceiptFile(null);
                  addInputRef.current?.focus();
                }}
              >
                Cancel
              </button>

              <button className="rounded-lg bg-white px-3 py-2 text-black" onClick={confirmPurchaseSingle}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt (multi-item) modal */}
      {receiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-black p-4 text-white border border-white/20">
            <h2 className="text-lg font-semibold">Attach receipt to {selectedItems.length} items</h2>

            <label className="mt-3 block text-sm text-gray-300">Purchased From</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={receiptStore}
              onChange={(e) => setReceiptStore(e.target.value)}
              placeholder="e.g., Walmart"
            />

            <label className="mt-3 block text-sm text-gray-300">Tax %</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-white"
              value={receiptTaxRate}
              onChange={(e) => setReceiptTaxRate(e.target.value)}
              placeholder="e.g., 7"
              inputMode="decimal"
            />

            <div className="mt-4 rounded-lg border border-white/20 p-3">
              <div className="text-sm font-medium">Item prices</div>
              <div className="mt-2 space-y-2">
                {selectedItems.map((it) => (
                  <div key={it.id} className="flex items-center gap-2">
                    <div className="flex-1 truncate text-sm">{it.title}</div>
                    <input
                      className="w-28 rounded-lg border border-white/20 bg-black px-2 py-1 text-sm text-white"
                      placeholder="0.00"
                      inputMode="decimal"
                      value={receiptPrices[it.id] ?? ""}
                      onChange={(e) =>
                        setReceiptPrices((prev) => ({ ...prev, [it.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            <label className="mt-3 block text-sm text-gray-300">Receipt photo (required)</label>
            <input
              className="mt-1 w-full rounded-lg border border-white/20 bg-black px-3 py-2 text-sm text-white"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setReceiptPhoto(e.target.files?.[0] ?? null)}
            />

            <div className="mt-3 rounded-lg border border-white/20 bg-white/5 p-2 text-sm">
              {receiptComputed ? (
                <>
                  <div>
                    Subtotal: <span className="font-medium">${receiptComputed.subtotal.toFixed(2)}</span>
                  </div>
                  <div>
                    Tax total: <span className="font-medium">${receiptComputed.taxTotal.toFixed(2)}</span>
                  </div>
                  <div>
                    Total: <span className="font-medium">${receiptComputed.total.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <div className="text-gray-300">
                  Enter a valid tax % and a price for each selected item.
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-white/20 px-3 py-2 hover:bg-white/10"
                onClick={() => setReceiptModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-white px-3 py-2 text-black disabled:opacity-60"
                disabled={!receiptComputed || !receiptPhoto}
                onClick={confirmAttachReceipt}
              >
                Save & mark purchased
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-black p-4 text-white border border-white/20">
            <h2 className="text-lg font-semibold">Delete item?</h2>
            <p className="mt-2 text-sm text-gray-300">
              Are you sure you want to delete <span className="font-semibold">“{deleteItemTitle}”</span>?
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-white/20 px-3 py-2 hover:bg-white/10"
                onClick={() => {
                  setDeleteItemId(null);
                  setDeleteItemTitle("");
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-lg border border-red-400/50 px-3 py-2 text-red-200 hover:bg-red-600/20"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}