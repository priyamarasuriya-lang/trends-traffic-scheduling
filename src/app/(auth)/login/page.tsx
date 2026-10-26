import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "@/components/forms/auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold">Sign in to TRENDS</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Traffic, scheduling &amp; billing management</p>
      <LoginForm next={next} />
    </div>
  );
}
