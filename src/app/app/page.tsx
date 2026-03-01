"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type Household = {
  id: string;
  name: string;
  role: string;
};

export default function AppPage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      setEmail(user.email ?? null);

      // Load households
      const { data: myHouseholds } = await supabase.rpc("my_households");
      setHouseholds(myHouseholds || []);

      // Load active household
      const { data: active } = await supabase.rpc("get_active_household");
      setActiveHousehold(active || null);

      // If user has households but none active, set first as active
      if (!active && myHouseholds && myHouseholds.length > 0) {
        await supabase.rpc("set_active_household", {
          p_household_id: myHouseholds[0].id,
        });
        setActiveHousehold(myHouseholds[0].id);
      }

      setLoading(false);
    }

    load();
  }, []);

  const switchHousehold = async (id: string) => {
    await supabase.rpc("set_active_household", { p_household_id: id });
    setActiveHousehold(id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

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

      <div className="mt-8 flex gap-3">
  <a
    href="/app/shopping"
    className="rounded-lg bg-black px-4 py-2 text-white"
  >
    Shopping
  </a>
        
        <button
          onClick={signOut}
          className="rounded-lg bg-black px-4 py-2 text-white"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}