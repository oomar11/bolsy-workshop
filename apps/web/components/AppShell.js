"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWaStatus } from "../lib/socket";

const links = [
  { href: "/", label: "الرئيسية" },
  { href: "/whatsapp", label: "ربط الواتساب" },
  { href: "/inbox", label: "وارد الشغل" },
  { href: "/jobs", label: "سجل التصنيع" },
  { href: "/customers", label: "العملاء" },
  { href: "/invoices", label: "الفواتير" },
  { href: "/payments", label: "الدفعات" },
  { href: "/statements", label: "الكشوف" },
  { href: "/settings", label: "الإعدادات" },
];

export function AppShell({ children }) {
  const pathname = usePathname() || "/";
  const wa = useWaStatus();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const connected = mounted && wa?.status === "connected";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <small>WORKSHOP OS</small>
          <strong>ضلف السلك البلسي</strong>
        </div>
        <nav className="nav">
          {links.map((link) => {
            const active =
              mounted && (pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href)));
            return (
              <Link key={link.href} href={link.href} className={active ? "active" : ""}>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="side-foot" suppressHydrationWarning>
          <div>{connected ? "واتساب متصل" : "واتساب غير متصل"}</div>
          <div>{mounted && wa?.selectedName ? wa.selectedName : "مفيش جروب متحدد"}</div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
