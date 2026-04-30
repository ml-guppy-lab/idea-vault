import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 text-center">
      {/* Ambient glow blobs */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-indigo-600/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />

      <div className="relative z-10 flex flex-col items-center gap-6">
        {/* Badge */}
        <Badge className="rounded-full border border-indigo-500/50 bg-indigo-500/10 px-4 py-1 text-sm font-medium text-indigo-300 backdrop-blur-sm">
          ✦ Never lose a thought again
        </Badge>

        {/* Heading */}
        <h1 className="bg-gradient-to-br from-white via-indigo-100 to-indigo-400 bg-clip-text text-6xl font-extrabold tracking-tight text-transparent sm:text-7xl">
          Idea Vault
        </h1>

        {/* Subtext */}
        <p className="max-w-md text-base text-slate-400">
          Capture, organise, and revisit your best ideas — all in one secure place.
        </p>

        {/* CTA */}
        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
          <Button className="rounded-full bg-indigo-600 px-8 py-5 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:bg-indigo-500 hover:shadow-indigo-400/40">
            Get Started
          </Button>
          <Button
            variant="outline"
            className="rounded-full border-slate-600 bg-transparent px-8 py-5 text-base font-semibold text-slate-300 backdrop-blur-sm transition-all hover:border-indigo-500 hover:text-indigo-300"
          >
            Learn More
          </Button>
        </div>
      </div>
    </main>
  )
}