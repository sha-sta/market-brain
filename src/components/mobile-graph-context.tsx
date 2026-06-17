"use client";

import { createContext, useContext, useMemo, useState } from "react";

// Shared visibility state for the mobile graph sheet, so the floating toggle (MobileGraphToggle) and
// the graph container (GraphPanel) agree on open/closed without remounting GraphShell. Desktop ignores
// this entirely (the graph is always the right panel at >= lg). Defaults closed each session.
interface MobileGraphState {
  visible: boolean;
  toggle: () => void;
  close: () => void;
}

const MobileGraphContext = createContext<MobileGraphState | null>(null);

export function MobileGraphProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const value = useMemo<MobileGraphState>(
    () => ({ visible, toggle: () => setVisible((v) => !v), close: () => setVisible(false) }),
    [visible],
  );
  return <MobileGraphContext.Provider value={value}>{children}</MobileGraphContext.Provider>;
}

export function useMobileGraph(): MobileGraphState {
  const ctx = useContext(MobileGraphContext);
  if (!ctx) throw new Error("useMobileGraph must be used within MobileGraphProvider");
  return ctx;
}
