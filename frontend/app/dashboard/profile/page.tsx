"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Camera,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  User,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  bio: string | null;
  gender: string | null;
  date_of_birth: string | null;
  avatar_url: string | null;
  auth_provider: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateInput(iso: string | null) {
  if (!iso) return "";
  return iso.split("T")[0]; // "YYYY-MM-DD"
}

function formatMemberSince(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === "dark";

  const fileRef = useRef<HTMLInputElement>(null);

  // ── State ────────────────────────────────────────────────────────────────

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // profile form
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // avatar
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // password
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // ── Fetch profile ────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => {
        if (r.status === 401) { router.push("/login"); return null; }
        return r.json();
      })
      .then((data: Profile | null) => {
        if (!data) return;
        setProfile(data);
        setDisplayName(data.display_name ?? "");
        setBio(data.bio ?? "");
        setGender(data.gender ?? "");
        setDob(toDateInput(data.date_of_birth));
        setAvatarPreview(data.avatar_url ?? null);
      })
      .finally(() => setLoading(false));
  }, [router]);

  // ── Colours (match app theme) ─────────────────────────────────────────────

  const bg      = isDark ? "rgba(16,22,38,0.85)"       : "rgba(255,255,255,0.72)";
  const border  = isDark ? "rgba(100,120,170,0.3)"     : "rgba(170,200,215,0.5)";
  const text    = isDark ? "#e8eef8"                   : "#1a3a44";
  const muted   = "#6b8fa0";
  const inputBg = isDark ? "rgba(255,255,255,0.06)"    : "rgba(255,255,255,0.75)";

  const cardStyle: React.CSSProperties = {
    background: bg,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderRadius: 24,
    border: `1px solid ${border}`,
    padding: "2rem",
    marginBottom: "1.5rem",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.65rem 0.9rem",
    borderRadius: 12,
    border: `1.5px solid ${border}`,
    background: inputBg,
    color: text,
    fontSize: "0.95rem",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: muted,
    marginBottom: "0.4rem",
    display: "block",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
          gender: gender || null,
          date_of_birth: dob || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMsg({ text: data.detail ?? "Failed to save profile.", ok: false });
      } else {
        setProfile(data);
        setProfileMsg({ text: "Profile saved!", ok: true });
      }
    } catch {
      setProfileMsg({ text: "Network error. Please try again.", ok: false });
    } finally {
      setSavingProfile(false);
    }
  }

  function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      setAvatarMsg({ text: "Image must be under 3 MB.", ok: false });
      return;
    }
    if (!file.type.startsWith("image/")) {
      setAvatarMsg({ text: "Please select a valid image file.", ok: false });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setAvatarPreview(dataUrl);
      setUploadingAvatar(true);
      setAvatarMsg(null);
      try {
        const res = await fetch("/api/profile/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar_url: dataUrl }),
        });
        const data = await res.json();
        if (!res.ok) {
          setAvatarMsg({ text: data.detail ?? "Upload failed.", ok: false });
          setAvatarPreview(profile?.avatar_url ?? null);
        } else {
          setProfile(data);
          setAvatarMsg({ text: "Profile picture updated!", ok: true });
        }
      } catch {
        setAvatarMsg({ text: "Network error.", ok: false });
      } finally {
        setUploadingAvatar(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);

    if (newPwd !== confirmPwd) {
      setPwdMsg({ text: "New passwords do not match.", ok: false });
      return;
    }
    if (newPwd.length < 8) {
      setPwdMsg({ text: "New password must be at least 8 characters.", ok: false });
      return;
    }
    if (!/[A-Z]/.test(newPwd)) {
      setPwdMsg({ text: "New password must contain at least one uppercase letter.", ok: false });
      return;
    }
    if (!/[0-9]/.test(newPwd)) {
      setPwdMsg({ text: "New password must contain at least one number.", ok: false });
      return;
    }

    setSavingPwd(true);
    try {
      const res = await fetch("/api/profile/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwdMsg({ text: data.detail ?? "Failed to change password.", ok: false });
      } else {
        setPwdMsg({ text: data.detail, ok: true });
        // Clear tokens and redirect to login — backend revoked all refresh tokens
        setTimeout(() => {
          fetch("/api/auth/session", { method: "DELETE" }).finally(() => {
            router.push("/login");
          });
        }, 2500);
      }
    } catch {
      setPwdMsg({ text: "Network error. Please try again.", ok: false });
    } finally {
      setSavingPwd(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!mounted || loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <Loader2 size={36} className="animate-spin" style={{ color: muted }} />
      </div>
    );
  }

  if (!profile) return null;

  const initial = (profile.display_name || profile.email).charAt(0).toUpperCase();
  const isGoogleUser = profile.auth_provider === "google";

  return (
    <div
      style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: "2.5rem 1.25rem 4rem",
      }}
    >
      {/* ── Page title ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: text, margin: 0 }}>
          My Profile
        </h1>
        <p style={{ color: muted, marginTop: "0.3rem", fontSize: "0.95rem" }}>
          Member since {formatMemberSince(profile.created_at)}
        </p>
      </div>

      {/* ── Avatar card ─────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
          {/* Avatar display */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="Profile"
                style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover", border: `3px solid ${border}` }}
              />
            ) : (
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)",
                  border: `3px solid ${border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2rem",
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {initial}
              </div>
            )}
            {uploadingAvatar && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Loader2 size={22} className="animate-spin" style={{ color: "#fff" }} />
              </div>
            )}
          </div>

          {/* Upload controls */}
          <div>
            <p style={{ fontWeight: 600, color: text, margin: "0 0 0.4rem" }}>
              {profile.display_name || profile.email.split("@")[0]}
            </p>
            <p style={{ color: muted, fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
              {profile.email}
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingAvatar}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 1rem",
                borderRadius: 50,
                border: `1.5px solid ${border}`,
                background: inputBg,
                color: text,
                fontSize: "0.85rem",
                fontWeight: 500,
                cursor: uploadingAvatar ? "not-allowed" : "pointer",
              }}
            >
              <Camera size={15} />
              {uploadingAvatar ? "Uploading…" : "Change Photo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleAvatarFile}
            />
            {avatarMsg && (
              <p style={{ fontSize: "0.82rem", color: avatarMsg.ok ? "#4caf50" : "#FF6B6B", marginTop: "0.5rem" }}>
                {avatarMsg.text}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Personal info form ───────────────────────────────────────── */}
      <form onSubmit={handleSaveProfile}>
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.5rem" }}>
            <User size={18} style={{ color: muted }} />
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: text, margin: 0 }}>
              Personal Information
            </h2>
          </div>

          <div style={{ display: "grid", gap: "1.1rem" }}>
            {/* Display name */}
            <div>
              <label style={labelStyle}>Display Name</label>
              <input
                type="text"
                placeholder="How should we call you?"
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Bio */}
            <div>
              <label style={labelStyle}>Bio</label>
              <textarea
                placeholder="A short bio about yourself…"
                maxLength={500}
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
              />
              <p style={{ fontSize: "0.78rem", color: muted, textAlign: "right", margin: "0.2rem 0 0" }}>
                {bio.length}/500
              </p>
            </div>

            {/* Gender + DOB on same row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }} className="max-[480px]:grid-cols-1">
              <div>
                <label style={labelStyle}>Gender</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="non_binary">Non-binary</option>
                  <option value="prefer_not_to_say">Keep it private</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Date of Birth</label>
                <input
                  type="date"
                  value={dob}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setDob(e.target.value)}
                  style={{ ...inputStyle, colorScheme: isDark ? "dark" : "light" }}
                />
              </div>
            </div>

            {/* Email (read-only) */}
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={profile.email}
                readOnly
                style={{ ...inputStyle, opacity: 0.6, cursor: "not-allowed" }}
              />
            </div>
          </div>

          {/* Save button + message */}
          <div style={{ marginTop: "1.5rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <button
              type="submit"
              disabled={savingProfile}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.65rem 1.6rem",
                borderRadius: 50,
                border: "none",
                background: "linear-gradient(135deg,#A8E6CF,#7ecbf0)",
                color: "#1a3a44",
                fontWeight: 700,
                fontSize: "0.95rem",
                cursor: savingProfile ? "not-allowed" : "pointer",
                opacity: savingProfile ? 0.7 : 1,
              }}
            >
              {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {savingProfile ? "Saving…" : "Save Profile"}
            </button>
            {profileMsg && (
              <span style={{ fontSize: "0.88rem", color: profileMsg.ok ? "#4caf50" : "#FF6B6B", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                {profileMsg.ok && <Check size={15} />}
                {profileMsg.text}
              </span>
            )}
          </div>
        </div>
      </form>

      {/* ── Change password (local auth only) ──────────────────────── */}
      {!isGoogleUser && (
        <form onSubmit={handleChangePassword}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.5rem" }}>
              <KeyRound size={18} style={{ color: muted }} />
              <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: text, margin: 0 }}>
                Change Password
              </h2>
            </div>

            <div style={{ display: "grid", gap: "1.1rem" }}>
              {/* Current password */}
              <div>
                <label style={labelStyle}>Current Password</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showCurrentPwd ? "text" : "password"}
                    placeholder="Enter current password"
                    required
                    value={currentPwd}
                    onChange={(e) => setCurrentPwd(e.target.value)}
                    style={{ ...inputStyle, paddingRight: "2.8rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPwd((p) => !p)}
                    style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: muted, padding: 0 }}
                  >
                    {showCurrentPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div>
                <label style={labelStyle}>New Password</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showNewPwd ? "text" : "password"}
                    placeholder="Min 8 chars, 1 uppercase, 1 number"
                    required
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    style={{ ...inputStyle, paddingRight: "2.8rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPwd((p) => !p)}
                    style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: muted, padding: 0 }}
                  >
                    {showNewPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Confirm new password */}
              <div>
                <label style={labelStyle}>Confirm New Password</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showConfirmPwd ? "text" : "password"}
                    placeholder="Repeat new password"
                    required
                    value={confirmPwd}
                    onChange={(e) => setConfirmPwd(e.target.value)}
                    style={{ ...inputStyle, paddingRight: "2.8rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPwd((p) => !p)}
                    style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: muted, padding: 0 }}
                  >
                    {showConfirmPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Password strength hint */}
            <p style={{ fontSize: "0.8rem", color: muted, marginTop: "0.6rem" }}>
              Password requirements: at least 8 characters, one uppercase letter, one number.
            </p>

            <div style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <button
                type="submit"
                disabled={savingPwd}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.65rem 1.6rem",
                  borderRadius: 50,
                  border: "none",
                  background: "linear-gradient(135deg,#ffb3b3,#ff6b6b)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.95rem",
                  cursor: savingPwd ? "not-allowed" : "pointer",
                  opacity: savingPwd ? 0.7 : 1,
                }}
              >
                {savingPwd ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                {savingPwd ? "Changing…" : "Change Password"}
              </button>
              {pwdMsg && (
                <span style={{ fontSize: "0.88rem", color: pwdMsg.ok ? "#4caf50" : "#FF6B6B", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  {pwdMsg.ok && <Check size={15} />}
                  {pwdMsg.text}
                </span>
              )}
            </div>

            {pwdMsg?.ok && (
              <p style={{ fontSize: "0.82rem", color: muted, marginTop: "0.5rem" }}>
                Redirecting you to login…
              </p>
            )}
          </div>
        </form>
      )}

      {/* ── Google user notice ───────────────────────────────────────── */}
      {isGoogleUser && (
        <div style={{ ...cardStyle, background: isDark ? "rgba(100,80,180,0.1)" : "rgba(230,220,255,0.5)" }}>
          <p style={{ color: muted, fontSize: "0.9rem", margin: 0 }}>
            <strong style={{ color: text }}>Signed in with Google.</strong>{" "}
            Password management is handled by your Google account.
          </p>
        </div>
      )}
    </div>
  );
}
