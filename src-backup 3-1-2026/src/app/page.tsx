"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");

  const signInGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/app` },
    });
    if (error) alert(error.message);
  };

  const sendMagicLink = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/app` },
    });
    if (error) alert(error.message);
    else alert("Check your email for the sign-in link.");
  };

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold">Login</h1>

      <button
        onClick={signInGoogle}
        className="mt-4 w-full rounded-lg bg-black px-4 py-3 text-white"
      >
        Continue with Google
      </button>

      <div className="my-6 border-t" />

      <label className="text-sm">Email login link</label>
      <input
        className="mt-2 w-full rounded-lg border px-3 py-2"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
      />
      <button
        onClick={sendMagicLink}
        className="mt-3 w-full rounded-lg border px-4 py-3"
      >
        Send magic link
      </button>
    </main>
  );
}