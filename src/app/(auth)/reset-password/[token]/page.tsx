import { ResetForm } from "@/components/forms/auth-forms";

export const metadata = { title: "Set new password" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Signing in again will be required on all devices.</p>
      <ResetForm token={token} />
    </div>
  );
}
