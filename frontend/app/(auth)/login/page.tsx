import BackgroundOrbs from "@/components/auth/BackgroundOrbs";
import AuthCard from "@/components/auth/AuthCard";
import LoginForm from "@/components/auth/LoginForm";

export const metadata = {
  title: "Sign In — Idea Vault",
  description: "Sign in to your Idea Vault account",
};

export default function LoginPage() {
  return (
    <>
      <div
        style={{
          minHeight: "100vh",
          backgroundImage:
            "linear-gradient(135deg, #d4f1f9 0%, #e8d5f5 30%, #fce4d6 60%, #d5f5e8 100%)",
          backgroundAttachment: "fixed",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          position: "relative",
        }}
        className="
          dark:[background-image:linear-gradient(135deg,#1a1a3e_0%,#1e2a4a_30%,#1a2035_60%,#1e1a35_100%)]
        "
      >
        <BackgroundOrbs />
        <AuthCard>
          <LoginForm />
        </AuthCard>
      </div>
    </>
  );
}
