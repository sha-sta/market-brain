import "server-only";
import nodemailer from "nodemailer";
import { gmailAppPassword, gmailUser } from "@/lib/env";
import { reportError } from "@/lib/observability";
import type { SendResult } from "./resend";

// Send the brief straight from a Gmail account via SMTP + an App Password. The no-domain path: it
// delivers to ANY recipient (e.g. dad's Gmail), free, ~500 sends/day — no DNS/domain verification.
// Requires 2-Step Verification on the account + an App Password (Google Account > Security > App
// passwords; the normal password won't work). Adapter pattern: degrades, never throws.

export async function sendViaGmail(opts: { to: string; subject: string; html: string }): Promise<SendResult> {
  const user = gmailUser();
  const pass = gmailAppPassword();
  if (!user || !pass) {
    return { ok: false, error: "GMAIL_USER / GMAIL_APP_PASSWORD unset — brief composed + archived but not emailed" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from: `MarketBrain <${user}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    reportError(e, { scope: "gmail.send" });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
