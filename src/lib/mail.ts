import nodemailer from "nodemailer";

export type MailDelivery = "email" | "console" | "none";

/** Real email is sent only when SMTP is configured (SMTP_HOST and MAIL_FROM, plus SMTP_USER/SMTP_PASS if the server needs a login). */
export const mailConfigured = () => !!process.env.SMTP_HOST && !!process.env.MAIL_FROM;

/** What the sign-in pages should tell the user, decided from configuration only (never from whether an account exists). */
export function deliveryMode(): MailDelivery {
  if (mailConfigured()) return "email";
  return process.env.NODE_ENV === "production" ? "none" : "console";
}

/**
 * Sends one email. Without SMTP settings it prints the message to the server terminal instead (development only),
 * so password reset still works on a laptop. In production without SMTP nothing is sent or logged.
 */
export async function sendMail(msg: { to: string; subject: string; text: string; html: string }): Promise<MailDelivery> {
  if (mailConfigured()) {
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({ from: process.env.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return "email";
  }
  if (process.env.NODE_ENV === "production") {
    console.error("[mail] SMTP is not configured (set SMTP_HOST and MAIL_FROM), so an email to a user was NOT sent.");
    return "none";
  }
  console.log(`\n[mail] SMTP is not configured, so this email is shown here instead of being sent.\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
  return "console";
}
