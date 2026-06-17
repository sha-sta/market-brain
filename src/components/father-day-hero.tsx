"use client";

import { useEffect, useState } from "react";

// A warm, dismissible "Happy Father's Day" banner on the home panel — this app is a gift. Dismissal
// is remembered in localStorage so it shows once and then steps out of the way. SSR-safe: renders
// nothing until the effect confirms it hasn't been dismissed (avoids a hydration flash).
const DISMISS_KEY = "mb-fathers-day-dismissed";

export function FatherDayHero() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== "1") setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore — worst case the banner reappears next session
    }
    setShow(false);
  };

  return (
    <div className="relative rounded-lg border border-border bg-[#f4f1ea] px-4 py-3">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute right-2 top-2 text-xs text-muted transition-colors hover:text-foreground"
      >
        Dismiss
      </button>
      <p className="text-sm font-medium text-foreground">Happy Father&apos;s Day, Dad.</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        This is a knowledge graph that grows around the companies, themes, and theses you follow —
        your holdings, your own notes, and the news on your names, all connected. Each morning it sends
        a brief on what changed. It surfaces and organizes; the calls are always yours.
      </p>
    </div>
  );
}
