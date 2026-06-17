"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-medium tracking-tight">MarketBrain</h1>
        <p className="text-sm text-muted">A private stock-market research graph. Approved members only.</p>
      </div>
      <button
        onClick={signInWithGoogle}
        disabled={loading}
        className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-foreground hover:text-background disabled:opacity-50"
      >
        {loading ? "Redirecting…" : "Sign in with Google"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
