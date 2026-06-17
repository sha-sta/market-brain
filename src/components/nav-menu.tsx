"use client";

import Link from "next/link";
import { useState } from "react";
import { signOut } from "@/app/(app)/actions";

// The navbar's links. At >= lg they're a horizontal row; below lg they collapse behind a hamburger
// that opens a dropdown. Kept as a client component (the hamburger needs open/close state); NavBar
// stays a server component and passes only `isAdmin`.
export function NavMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const link = "text-muted transition-colors hover:text-foreground";
  const close = () => setOpen(false);

  const links = (
    <>
      <Link href="/" className={link} onClick={close}>
        Home
      </Link>
      <Link href="/portfolio" className={link} onClick={close}>
        Portfolio
      </Link>
      <Link href="/brief" className={link} onClick={close}>
        Brief
      </Link>
      <Link href="/dump" className={link} onClick={close}>
        Dump
      </Link>
      <Link href="/ask" className={link} onClick={close}>
        Ask
      </Link>
      {isAdmin && (
        <Link href="/admin" className={link} onClick={close}>
          Admin
        </Link>
      )}
      <form action={signOut}>
        <button type="submit" className={link}>
          Sign out
        </button>
      </form>
    </>
  );

  return (
    <>
      <nav className="hidden items-center gap-5 text-sm lg:flex">{links}</nav>

      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-sm text-muted transition-colors hover:text-foreground lg:hidden"
      >
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div className="absolute right-0 top-14 z-50 flex flex-col items-end gap-3 border-b border-l border-border bg-background p-4 text-sm shadow-lg lg:hidden">
          {links}
        </div>
      )}
    </>
  );
}
