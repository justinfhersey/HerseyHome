"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const [name, setName] = useState("Hersey Home");
  const [out, setOut] = useState("");
  const router = useRouter();

  const createHousehold = async () => {
    setOut("Working...");
    const { data, error } = await supabase.rpc("create_household_with_defaults", { p_name: name });

    if (error) {
      setOut(error.message);
      return;
    }

    setOut(`Created household: ${data}`);

    // ✅ go to main app
    router.push("/app");
  };

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Household setup</h1>
      <p className="mt-2 text-sm text-gray-600">
        Create your household so you and your wife can share lists and events.
      </p>

      <input
        className="mt-4 w-full rounded-lg border px-3 py-2"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <button
        onClick={createHousehold}
        className="mt-3 rounded-lg bg-black px-4 py-2 text-white"
      >
        Create Household
      </button>

      <pre className="mt-4 whitespace-pre-wrap rounded-lg border p-3 text-sm">{out}</pre>
    </main>
  );
}