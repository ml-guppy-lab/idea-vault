"use client";

import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.push("/login");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        gap: "1.5rem",
      }}
    >
      <p style={{ fontSize: "1.2rem", color: "#2d5766" }}>
        Dashboard — coming soon
      </p>
      <button
        onClick={handleLogout}
        style={{
          padding: "0.6rem 1.6rem",
          borderRadius: 50,
          border: "2px solid #2d5766",
          background: "transparent",
          color: "#2d5766",
          fontWeight: 600,
          cursor: "pointer",
          fontSize: "0.95rem",
        }}
      >
        Log out
      </button>
    </div>
  );
}

