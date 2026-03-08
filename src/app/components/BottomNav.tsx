"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/matches", label: "Matches" },
  { href: "/clubs", label: "Clubs" },
  { href: "/profile", label: "Profile" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-[color:var(--border)] bg-[color:var(--bg)]/95 backdrop-blur">
      <div className="container-max py-2">
        <div className="grid grid-cols-5 items-center gap-2">
          {LINKS.slice(0, 2).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`btn btn-ghost ${pathname === l.href ? "navlink-active" : ""}`}
            >
              {l.label}
            </Link>
          ))}

          <Link href="/matches/new" className="btn btn-primary">
            New
          </Link>

          {LINKS.slice(2).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`btn btn-ghost ${pathname === l.href ? "navlink-active" : ""}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}