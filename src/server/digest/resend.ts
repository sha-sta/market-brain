import "server-only";
import { Resend } from "resend";
import { resendFrom, resendKey } from "@/lib/env";
import { reportError } from "@/lib/observability";

// Send the morning brief via Resend. Adapter pattern: degrade, never throw — a mail outage must not
// fail the cron (the brief is still archived in digest_log for the in-app /brief view). NOTE: on the
// Resend free tier, delivery only works to your own account email until a sending domain is verified.

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendBrief(opts: { to: string; subject: string; html: string }): Promise<SendResult> {
  const key = resendKey();
  if (!key) return { ok: false, error: "RESEND_API_KEY unset — brief composed + archived but not emailed" };
  const from = resendFrom() ?? "MarketBrain <onboarding@resend.dev>";
  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send({ from, to: opts.to, subject: opts.subject, html: opts.html });
    if (error) {
      reportError(new Error(error.message), { scope: "resend.send" });
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    reportError(e, { scope: "resend.send" });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
