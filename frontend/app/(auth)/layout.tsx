/**
 * Auth group layout — forces light mode for login/signup pages regardless of
 * the user's system or app theme preference. Dark mode only applies once
 * logged in to the dashboard.
 */
"use client";

import { useEffect, useRef } from "react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  // When this layout mounts, temporarily remove "dark" from <html> so
  // Tailwind dark: variants don't fire on auth pages. Restore on unmount.
  useEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains("dark");
    html.classList.remove("dark");
    return () => {
      if (wasDark) html.classList.add("dark");
    };
  }, []);

  return (
    <div ref={ref} style={{ colorScheme: "light" }}>
      {children}
    </div>
  );
}

