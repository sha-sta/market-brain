"use client";

import { useEffect, useState } from "react";

// The lg breakpoint (Tailwind default 1024px) is where the layout switches from a two-panel desktop
// view to a single-column mobile view with a toggleable graph sheet.
export const LG_BREAKPOINT = 1024;

/** Pure: is this viewport width below the lg breakpoint? */
export function computeIsMobile(width: number): boolean {
  return width < LG_BREAKPOINT;
}

/** Tracks whether the viewport is below lg. SSR-safe: starts false, then syncs in an effect (so the
 *  server render and first client render match; avoids a hydration mismatch). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${LG_BREAKPOINT - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}
