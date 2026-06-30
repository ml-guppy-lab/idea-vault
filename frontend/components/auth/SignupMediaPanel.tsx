import { Lock } from "lucide-react";

interface SignupMediaPanelProps {
  videoSrc?: string;
  imageSrc?: string;
  /** Shown in light mode when both light/dark sources are provided. */
  imageSrcLight?: string;
  /** Shown in dark mode when both light/dark sources are provided. */
  imageSrcDark?: string;
}

/* Decorative "vault" backdrop — tiny locks scattered at varied angles. Sits
   behind the card; purely cosmetic so it's pointer-inert and aria-hidden. */
const LOCKS: { top: string; left: string; rotate: number; size: number }[] = [
  { top: "8%", left: "12%", rotate: -22, size: 18 },
  { top: "14%", left: "78%", rotate: 30, size: 14 },
  { top: "26%", left: "30%", rotate: 12, size: 16 },
  { top: "22%", left: "55%", rotate: -38, size: 12 },
  { top: "40%", left: "8%", rotate: 44, size: 20 },
  { top: "48%", left: "88%", rotate: -16, size: 16 },
  { top: "58%", left: "20%", rotate: 24, size: 13 },
  { top: "64%", left: "68%", rotate: -28, size: 18 },
  { top: "72%", left: "42%", rotate: 18, size: 14 },
  { top: "82%", left: "14%", rotate: -34, size: 16 },
  { top: "86%", left: "82%", rotate: 36, size: 12 },
  { top: "90%", left: "50%", rotate: -10, size: 18 },
  { top: "34%", left: "70%", rotate: 8, size: 13 },
  { top: "6%", left: "44%", rotate: -46, size: 12 },
  { top: "4%", left: "66%", rotate: 26, size: 14 },
  { top: "12%", left: "28%", rotate: -14, size: 12 },
  { top: "18%", left: "92%", rotate: 40, size: 16 },
  { top: "30%", left: "48%", rotate: -30, size: 14 },
  { top: "36%", left: "18%", rotate: 20, size: 12 },
  { top: "44%", left: "60%", rotate: -42, size: 18 },
  { top: "52%", left: "36%", rotate: 14, size: 13 },
  { top: "54%", left: "74%", rotate: -20, size: 16 },
  { top: "62%", left: "10%", rotate: 32, size: 14 },
  { top: "68%", left: "54%", rotate: -36, size: 12 },
  { top: "76%", left: "78%", rotate: 22, size: 18 },
  { top: "78%", left: "30%", rotate: -12, size: 14 },
  { top: "88%", left: "64%", rotate: 28, size: 13 },
  { top: "94%", left: "24%", rotate: -26, size: 16 },
  { top: "16%", left: "6%", rotate: 16, size: 12 },
  { top: "70%", left: "90%", rotate: -40, size: 14 },
];

export default function SignupMediaPanel({
  videoSrc,
  imageSrc,
  imageSrcLight,
  imageSrcDark,
}: SignupMediaPanelProps) {
  return (
    <aside
      className="relative hidden h-full w-full overflow-visible bg-white lg:flex lg:items-center lg:justify-center lg:p-10 dark:bg-[#0f172a]"
      aria-label="Idea Vault preview"
    >
      {/* Tiny-locks backdrop — clipped to the panel, behind the card (z-0). */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        {LOCKS.map((lock, i) => (
          <Lock
            key={i}
            size={lock.size}
            strokeWidth={1.75}
            className="absolute text-slate-500/55 dark:text-sky-400/40"
            style={{
              top: lock.top,
              left: lock.left,
              transform: `rotate(${lock.rotate}deg)`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 h-[74%] w-[74%] overflow-hidden rounded-2xl border border-slate-300 shadow-[0_20px_48px_rgba(15,23,42,0.22)] dark:border-slate-600 dark:shadow-[0_20px_50px_rgba(56,189,248,0.3),0_0_30px_rgba(56,189,248,0.15)]">
        {imageSrcLight && imageSrcDark ? (
          <>
            {/* Theme-swapped banners — toggled purely with CSS (no JS, no flash).
                Each slowly pans left↔right to reveal the full width of the shot. */}
            <div
              className="absolute inset-0 h-full w-full bg-cover animate-banner-pan dark:hidden"
              style={{ backgroundImage: `url('${imageSrcLight}')` }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-0 hidden h-full w-full bg-cover animate-banner-pan dark:block"
              style={{ backgroundImage: `url('${imageSrcDark}')` }}
              aria-hidden="true"
            />
          </>
        ) : imageSrc ? (
          <div
            className="h-full w-full bg-cover bg-center"
            style={{
              backgroundImage: `url('${imageSrc}')`,
            }}
            aria-hidden="true"
          />
        ) : videoSrc ? (
          <video
            className="h-full w-full object-cover"
            src={videoSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
          />
        ) : null}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/7 via-transparent to-black/3" />
      </div>
    </aside>
  );
}
