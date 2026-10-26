import { ForgotForm } from "@/components/forms/auth-forms";

export const metadata = { title: "Forgot password" };

export default function Page() {
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">We will email you a link that is valid for 60 minutes.</p>
      <ForgotForm />
    </div>
  );
}
