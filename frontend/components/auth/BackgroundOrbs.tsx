/**
 * BackgroundOrbs — purely decorative radial gradient orbs.
 *
 * Positioned fixed so they don't scroll with content. They sit behind
 * everything (z-index 0) and adjust color in dark mode.
 */

export default function BackgroundOrbs() {
  return (
    <>
      {/* Orb 1 — top-right, green in light / purple in dark */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: "-15%",
          right: "-10%",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, #A8E6CF 0%, transparent 70%)",
          opacity: 0.25,
          zIndex: 0,
          pointerEvents: "none",
        }}
        className="dark:[background:radial-gradient(circle,#B980F0_0%,transparent_70%)] dark:!opacity-20"
      />

      {/* Orb 2 — bottom-left, purple in light / blue in dark */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          bottom: "-10%",
          left: "-8%",
          width: 450,
          height: 450,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, #E2B0FF 0%, transparent 70%)",
          opacity: 0.2,
          zIndex: 0,
          pointerEvents: "none",
        }}
        className="dark:[background:radial-gradient(circle,#38bdf8_0%,transparent_70%)] dark:!opacity-15"
      />
    </>
  );
}
