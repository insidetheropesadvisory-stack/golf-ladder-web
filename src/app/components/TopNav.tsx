"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/supabase";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/matches", label: "Matches" },
  { href: "/clubs", label: "Clubs" },
  { href: "/profile", label: "Profile" },
];

function Crest() {
  return (
    <div className="h-9 w-9 rounded-full border border-[color:var(--border)] bg-[color:var(--card)] flex items-center justify-center">
      <span className="font-[family-name:var(--font-serif)] text-[color:var(--navy)] font-semibold">
        R
      </span>
    </div>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[color:var(--border)] bg-[color:var(--bg)]">
      <div className="container-max py-3">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3">
            <Crest />
            <div className="leading-tight">
              <div className="font-[family-name:var(--font-serif)] text-lg font-semibold">
                Reciprocity
              </div>
              <div className="text-xs text-[color:var(--muted)] -mt-0.5">
                private club competition, refined
              </div>
            </div>
          </Link>

          {/* Desktop */}
          <nav className="hidden md:flex items-center gap-6">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`navlink ${active ? "navlink-active" : ""}`}
                >
                  {l.label}
                </Link>
              );
            })}
            <Link className="btn btn-primary" href="/matches/new">
              New match
            </Link>
            <button className="btn btn-ghost" onClick={logout}>
              Logout
            </button>
          </nav>

          {/* Mobile */}
          <div className="md:hidden flex items-center gap-2">
            <Link className="btn btn-primary" href="/matches/new">
              New
            </Link>
            <button className="btn" onClick={() => setOpen((v) => !v)}>
              {open ? "Close" : "Menu"}
            </button>
          </div>
        </div>

        {open ? (
          <div className="md:hidden mt-3 card card-pad">
            <div className="flex flex-col gap-3">
              {LINKS.map((l) => {
                const active = pathname === l.href;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={`navlink ${active ? "navlink-active" : ""}`}
                  >
                    {l.label}
                  </Link>
                );
              })}
              <div className="pt-2 border-t border-[color:var(--border)] flex gap-2">
                <Link className="btn btn-primary flex-1" href="/matches/new" onClick={() => setOpen(false)}>
                  New match
                </Link>
                <button className="btn flex-1" onClick={logout}>
                  Logout
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}