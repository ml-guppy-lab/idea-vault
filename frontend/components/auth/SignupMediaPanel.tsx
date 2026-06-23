interface SignupMediaPanelProps {
  videoSrc?: string;
  imageSrc?: string;
}

export default function SignupMediaPanel({ videoSrc, imageSrc }: SignupMediaPanelProps) {
  return (
    <aside
      className="relative hidden h-full w-full overflow-hidden bg-white lg:flex lg:items-center lg:justify-center lg:p-8"
      aria-label="Idea Vault preview"
    >
      <div className="relative h-[78%] w-[78%] overflow-hidden rounded-3xl border border-slate-200/80 shadow-[0_24px_64px_rgba(15,23,42,0.2)]">
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

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/12 via-transparent to-black/8" />
      </div>
    </aside>
  );
}
