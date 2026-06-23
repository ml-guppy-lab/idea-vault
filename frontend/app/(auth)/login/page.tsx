import LoginForm from "@/components/auth/LoginForm";
import SignupMediaPanel from "@/components/auth/SignupMediaPanel";
import { Plus_Jakarta_Sans } from "next/font/google";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata = {
  title: "Sign In — Idea Vault",
  description: "Sign in to your Idea Vault account",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      {/* Left: Auth Section */}
      <section className={`${jakarta.className} flex min-h-screen flex-col items-center justify-center bg-white px-4 py-8 sm:px-6 lg:px-12 dark:bg-[#0f172a]`}>
        <div className="w-full max-w-sm space-y-5">
          {/* Header */}
          <div className="space-y-2">
            <h1 className="text-[2rem] font-semibold leading-tight text-slate-900 dark:text-white">Welcome to Idea Vault</h1>
            <p className="text-[0.98rem] leading-snug text-slate-600 dark:text-slate-400">
              Your AI assistant for capturing and organizing ideas
            </p>
          </div>

          {/* Form */}
          <LoginForm />
        </div>
      </section>

      {/* Right: Media Section */}
      <section className="hidden lg:block lg:h-screen">
        <SignupMediaPanel imageSrc="/ui-media/homepage2.png" />
      </section>
    </div>
  );
}
