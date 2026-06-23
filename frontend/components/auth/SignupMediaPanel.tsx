interface SignupMediaPanelProps {
  videoSrc?: string;
  imageSrc?: string;
}

export default function SignupMediaPanel({ videoSrc, imageSrc }: SignupMediaPanelProps) {
  return (
    <aside
      className="relative hidden h-full w-full overflow-visible bg-white lg:flex lg:items-center lg:justify-center lg:p-10 dark:bg-[#0f172a]"
      aria-label="Idea Vault preview"
    >
      <div className="relative h-[74%] w-[74%] overflow-hidden rounded-2xl border border-slate-300 shadow-[0_20px_48px_rgba(15,23,42,0.22)] dark:border-slate-600 dark:shadow-[0_20px_50px_rgba(56,189,248,0.3),0_0_30px_rgba(56,189,248,0.15)]">
        {imageSrc ? (
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
