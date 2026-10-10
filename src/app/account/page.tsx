import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/auth-extra";

export const metadata: Metadata = { title: "Account · Growth Agent" };

export default function AccountPage() {
  return <ChangePasswordForm />;
}
