import type { Metadata } from "next";
import { ForgotForm } from "@/components/auth-extra";

export const metadata: Metadata = { title: "Forgot password · Growth Agent" };

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
