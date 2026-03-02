"use client";

import Link from "next/link";

export default function ShoppingHubPage() {
  return (
    <main className="mx-auto max-w-2xl p-6 text-white">
      <h1 className="text-2xl font-semibold">Shopping</h1>
      <p className="mt-2 text-sm text-gray-400">
        Choose what you want to work with.
      </p>

      <div className="mt-6 grid gap-3">
        <Link
          href="/app/shopping/list"
          className="rounded-xl border border-white/20 bg-black p-4 hover:bg-white/10"
        >
          <div className="text-lg font-semibold">Shopping List</div>
          <div className="mt-1 text-sm text-gray-400">
            Add items, check off purchases, and attach receipts.
          </div>
        </Link>

        <Link
          href="/app/shopping/receipts"
          className="rounded-xl border border-white/20 bg-black p-4 hover:bg-white/10"
        >
          <div className="text-lg font-semibold">Receipts</div>
          <div className="mt-1 text-sm text-gray-400">
            Browse receipt history and view details.
          </div>
        </Link>
      </div>

      <div className="mt-6">
        <Link href="/app" className="text-sm text-gray-300 hover:underline">
          ← Back
        </Link>
      </div>
    </main>
  );
}