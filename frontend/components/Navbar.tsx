"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  Settings,
  Sun,
  Moon,
  LogOut,
  User,
  X,
  Menu,
  Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavbarProps {
  user: {
    name: string;
    email: string;
    avatarUrl?: string;
  } | null;
}

// ── Nav links ─────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard",          icon: LayoutDashboard },
  { label: "Profile",   href: "/dashboard/profile",  icon: User },
  { label: "Settings",  href: "/dashboard/settings", icon: Settings },
];

// ── Navbar ────────────────────────────────────────────────────────────────────

export default function Navbar({ user }: NavbarProps) {
  const router   = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  const [dropdownOpen, setDropdownOpen]   = useState(false);
  const [mobileOpen,   setMobileOpen]     = useState(false);
  const [loggingOut,   setLoggingOut]     = useState(false);
  const [mounted,      setMounted]        = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // next-themes is SSR-safe only after mount
  useEffect(() => { setMounted(true); }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close mobile menu + dropdown on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      // Server route reads the httpOnly refresh token cookie (JS can't see it),
      // revokes it on the backend, then clears both auth cookies.
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // If the call fails, cookies are still cleared on the next line
    } finally {
      router.push("/login");
    }
  }, [router]);

  const initial = user?.name?.charAt(0).toUpperCase() ?? "?";

  // ── Shared styles ──────────────────────────────────────────────────────────

  const navbarBg   = isDark ? "rgba(16,22,38,0.8)"       : "rgba(255,255,255,0.65)";
  const navbarBdr  = isDark ? "rgba(100,120,170,0.35)"   : "rgba(170,200,215,0.5)";
  const navbarShad = isDark ? "0 4px 12px rgba(0,0,0,0.2)" : "0 4px 12px rgba(80,120,140,0.08)";

  const linkColor       = isDark ? "#b8c8e0" : "#3d6678";
  const linkHoverColor  = isDark ? "#e8eef8" : "#1a3a44";
  const linkHoverBg     = "rgba(168,230,207,0.15)";
  const linkActiveBg    = "rgba(168,230,207,0.2)";
  const linkActiveColor = isDark ? "#e8eef8" : "#1a3a44";

  const toggleBg  = isDark ? "rgba(10,16,28,0.65)"       : "rgba(255,255,255,0.6)";
  const iconColor = isDark ? "#b8c8e0"                    : "#3d6678";

  const logoGrad  = isDark
    ? "linear-gradient(135deg,#c0a0f0,#7dd3fc)"
    : "linear-gradient(135deg,#2d5766,#1e404b)";

  const taglineColor = isDark ? "#7a8faa" : "#6b8fa0";

  // ── Nav link renderer ──────────────────────────────────────────────────────

  function NavLink({
    href,
    label,
    icon: Icon,
    onClick,
    mobile = false,
  }: {
    href: string;
    label: string;
    icon: React.ElementType;
    onClick?: () => void;
    mobile?: boolean;
  }) {
    const isActive = pathname === href || pathname.startsWith(href + "/");
    const [hovered, setHovered] = useState(false);

    return (
      <Link
        href={href}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: mobile ? "0.6rem 1rem" : "0.5rem 1rem",
          borderRadius: 50,
          fontSize: mobile ? "1rem" : "0.9rem",
          fontWeight: isActive ? 600 : 500,
          color: isActive ? linkActiveColor : (hovered ? linkHoverColor : linkColor),
          background: isActive ? linkActiveBg : (hovered ? linkHoverBg : "transparent"),
          transition: "all 0.2s ease",
          textDecoration: "none",
          width: mobile ? "100%" : "auto",
        }}
      >
        <Icon size={18} />
        {label}
      </Link>
    );
  }

  // ── Dropdown item renderer ─────────────────────────────────────────────────

  function DropdownItem({
    icon: Icon,
    label,
    onClick,
    danger = false,
    loading = false,
  }: {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    danger?: boolean;
    loading?: boolean;
  }) {
    const [hovered, setHovered] = useState(false);
    const color = danger ? "#FF6B6B" : (hovered ? linkHoverColor : linkColor);

    return (
      <button
        role="menuitem"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        disabled={loading}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          width: "100%",
          padding: "0.6rem 0.8rem",
          borderRadius: 12,
          fontSize: "0.9rem",
          fontWeight: 500,
          color,
          background: hovered ? linkHoverBg : "transparent",
          border: "none",
          cursor: loading ? "not-allowed" : "pointer",
          transition: "all 0.15s ease",
          textAlign: "left",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
        {loading ? "Logging out…" : label}
      </button>
    );
  }

  // ── Avatar ─────────────────────────────────────────────────────────────────

  function Avatar({ size = 44 }: { size?: number }) {
    if (user?.avatarUrl) {
      return (
        <img
          src={user.avatarUrl}
          alt={user.name}
          width={size}
          height={size}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            objectFit: "cover",
            border: "3px solid rgba(255,255,255,0.7)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          }}
        />
      );
    }
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)",
          border: "3px solid rgba(255,255,255,0.7)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: size > 36 ? "1.1rem" : "0.9rem",
          flexShrink: 0,
        }}
      >
        {initial}
      </div>
    );
  }

  // ── Dropdown panel ─────────────────────────────────────────────────────────

  const dropdownBg  = isDark ? "rgba(20,28,45,0.94)"             : "rgba(255,255,255,0.92)";
  const dropdownBdr = isDark ? "rgba(180,160,240,0.25)"          : "rgba(255,255,255,0.7)";
  const dropdownShd = isDark ? "0 20px 40px rgba(0,0,0,0.5)"    : "0 20px 40px rgba(60,100,130,0.2)";
  const dividerClr  = isDark ? "rgba(100,120,170,0.35)"          : "rgba(170,200,215,0.4)";

  const textPrimary = isDark ? "#e8eef8" : "#1a3a44";
  const textMuted   = "#6b8fa0";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Sticky Navbar ─────────────────────────────────────────────────── */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.9rem 2rem",
          background: navbarBg,
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          borderBottom: `1px solid ${navbarBdr}`,
          boxShadow: navbarShad,
          borderRadius: "0 0 24px 24px",
          transition: "background 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease",
        }}
        className="max-[480px]:!rounded-none max-[480px]:!px-4 max-[480px]:!py-4"
      >
        {/* ── Section A: Logo ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link
            href="/dashboard"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              textDecoration: "none",
            }}
          >
            <img src="/logo1.jpeg" alt="Idea Vault" style={{ width: 36, height: 36, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
            <span className="logo-text">
              Idea Vault
            </span>
          </Link>
          <span
            style={{ fontSize: "0.8rem", fontStyle: "italic", color: taglineColor }}
            className="hidden sm:inline"
          >
            — Never lose a thought again
          </span>
        </div>

        {/* ── Section B: Nav links (desktop) ──────────────────────────────── */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <NavLink key={l.href} {...l} />
          ))}
        </div>

        {/* ── Section C: Theme + Avatar + Hamburger ───────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>

          {/* Theme toggle — hidden on mobile (available in hamburger menu) */}
          {mounted && (
            <div className="hidden md:block">
            <ThemeToggleButton
              isDark={isDark}
              toggleBg={toggleBg}
              navbarBdr={navbarBdr}
              iconColor={iconColor}
              onToggle={() => setTheme(isDark ? "light" : "dark")}
            />
            </div>
          )}

          {/* Hamburger — mobile only */}
          <button
            className="flex md:hidden"
            aria-label="Open navigation menu"
            onClick={() => setMobileOpen(true)}
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: toggleBg,
              border: `2px solid ${navbarBdr}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: iconColor,
              flexShrink: 0,
            }}
          >
            <Menu size={22} />
          </button>

          {/* User avatar + dropdown — desktop only; mobile gets it via hamburger */}
          {user && (
            <div className="hidden md:flex" style={{ alignItems: "center", gap: "0.5rem" }}>
              {/* Logout icon — desktop only */}
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                aria-label="Log out"
                className="hidden md:flex"
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: toggleBg,
                  border: `2px solid ${navbarBdr}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: loggingOut ? "not-allowed" : "pointer",
                  color: "#FF6B6B",
                  flexShrink: 0,
                  opacity: loggingOut ? 0.7 : 1,
                  transition: "all 0.2s ease",
                }}
              >
                {loggingOut ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
              </button>

              <div ref={dropdownRef} style={{ position: "relative" }}>
              <button
                onClick={() => setDropdownOpen((o) => !o)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
              >
                <Avatar />
              </button>

              {dropdownOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 12px)",
                    right: 0,
                    minWidth: 220,
                    background: dropdownBg,
                    backdropFilter: "blur(26px)",
                    WebkitBackdropFilter: "blur(26px)",
                    borderRadius: 20,
                    border: `1px solid ${dropdownBdr}`,
                    boxShadow: dropdownShd,
                    padding: "0.6rem",
                    zIndex: 200,
                    animation: "dropdown-in 0.2s ease forwards",
                  }}
                >
                  {/* User info */}
                  <div style={{ padding: "0.6rem 0.8rem", marginBottom: "0.4rem" }}>
                    <p style={{ fontWeight: 600, fontSize: "0.95rem", color: textPrimary, margin: 0 }}>
                      {user.name}
                    </p>
                    <p style={{ fontSize: "0.8rem", color: textMuted, margin: "0.15rem 0 0" }}>
                      {user.email}
                    </p>
                  </div>
                  <div style={{ height: 1, background: dividerClr, margin: "0 0.4rem 0.4rem" }} />

                  <DropdownItem
                    icon={User}
                    label="My Profile"
                    onClick={() => { setDropdownOpen(false); router.push("/dashboard/profile"); }}
                  />
                  <DropdownItem
                    icon={Settings}
                    label="Settings"
                    onClick={() => { setDropdownOpen(false); router.push("/dashboard/settings"); }}
                  />

                  <div style={{ height: 1, background: dividerClr, margin: "0.4rem" }} />

                  <DropdownItem
                    icon={LogOut}
                    label="Logout"
                    danger
                    loading={loggingOut}
                    onClick={() => { setDropdownOpen(false); handleLogout(); }}
                  />
                </div>
              )}
            </div>
            </div>
          )}
        </div>
      </nav>

      {/* ── Mobile menu overlay ────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 150,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
          onClick={() => setMobileOpen(false)}
        >
          {/* Panel — stop click propagation so clicking inside doesn't close it */}
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: 280,
              height: "100vh",
              background: isDark ? "rgba(18,25,42,0.97)" : "rgba(255,255,255,0.95)",
              backdropFilter: "blur(28px)",
              WebkitBackdropFilter: "blur(28px)",
              borderRight: `1px solid ${navbarBdr}`,
              padding: "2rem 1.5rem",
              boxShadow: "10px 0 40px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
              animation: "mobile-menu-in 0.3s ease-out forwards",
              overflowY: "auto",
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              style={{
                position: "absolute",
                top: "1.2rem",
                right: "1.2rem",
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: toggleBg,
                border: `2px solid ${navbarBdr}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: iconColor,
              }}
            >
              <X size={18} />
            </button>

            {/* Logo */}
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                textDecoration: "none",
                marginBottom: "1.5rem",
              }}
            >
              <img src="/logo1.jpeg" alt="Idea Vault" style={{ width: 28, height: 28, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
              <span
                style={{
                  fontSize: "1.3rem",
                  fontWeight: 700,
                }}
                className="logo-text"
              >
                Idea Vault
              </span>
            </Link>

            {/* Nav links */}
            {NAV_LINKS.map((l) => (
              <NavLink key={l.href} {...l} mobile onClick={() => setMobileOpen(false)} />
            ))}

            <div style={{ height: 1, background: dividerClr, margin: "1rem 0" }} />

            {/* Theme toggle row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.2rem 0.5rem" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 500, color: linkColor }}>Theme</span>
              {mounted && (
                <ThemeToggleButton
                  isDark={isDark}
                  toggleBg={toggleBg}
                  navbarBdr={navbarBdr}
                  iconColor={iconColor}
                  onToggle={() => setTheme(isDark ? "light" : "dark")}
                />
              )}
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* User info + logout at the bottom — always shown */}
            <div style={{ height: 1, background: dividerClr, margin: "0.5rem 0" }} />
            {user && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0.5rem" }}>
                <Avatar size={38} />
                <div>
                  <p style={{ fontWeight: 600, fontSize: "0.9rem", color: textPrimary, margin: 0 }}>{user.name}</p>
                  <p style={{ fontSize: "0.75rem", color: textMuted, margin: 0 }}>{user.email}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => { setMobileOpen(false); handleLogout(); }}
              disabled={loggingOut}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                width: "100%",
                padding: "0.75rem",
                borderRadius: 50,
                border: "2px solid #FF6B6B",
                background: "transparent",
                color: "#FF6B6B",
                fontWeight: 600,
                fontSize: "0.9rem",
                cursor: loggingOut ? "not-allowed" : "pointer",
                marginTop: "0.5rem",
                opacity: loggingOut ? 0.7 : 1,
              }}
            >
              {loggingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </div>
      )}

      {/* ── Keyframe animations ────────────────────────────────────────────── */}
      <style>{`
        @keyframes dropdown-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes mobile-menu-in {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

// ── Theme toggle button (extracted to avoid repetition) ───────────────────────

function ThemeToggleButton({
  isDark,
  toggleBg,
  navbarBdr,
  iconColor,
  onToggle,
}: {
  isDark: boolean;
  toggleBg: string;
  navbarBdr: string;
  iconColor: string;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const hoverShadow = isDark
    ? "0 0 35px rgba(185,128,240,0.4)"
    : "0 0 35px rgba(168,230,207,0.35)";

  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Toggle dark mode"
      style={{
        width: 42,
        height: 42,
        borderRadius: "50%",
        background: toggleBg,
        border: `2px solid ${navbarBdr}`,
        boxShadow: hovered ? hoverShadow : "0 4px 12px rgba(80,120,140,0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: iconColor,
        transform: hovered ? "scale(1.08)" : "scale(1)",
        transition: "all 0.25s ease",
        flexShrink: 0,
      }}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
