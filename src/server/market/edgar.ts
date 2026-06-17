import "server-only";
import { secEdgarUa } from "@/lib/env";
import { normCik } from "@/server/normalize/dedupe";
import { getJson, str } from "./http";
import type { Filing } from "./types";

// SEC EDGAR — keyless, but REQUIRES a User-Agent of the form "Name email@example.com" or it 403s.
// Stays dormant (returns []) when SEC_EDGAR_UA is unset. https://www.sec.gov/os/accessing-edgar-data

const SUBMISSIONS = "https://data.sec.gov/submissions";

export interface EdgarClient {
  recentFilings(cik: string, formTypes: string[]): Promise<Filing[]>;
}

export function edgarClient(): EdgarClient {
  return {
    async recentFilings(cik, formTypes) {
      const ua = secEdgarUa();
      if (!ua) return []; // never hit SEC without a UA — it would 403
      const bare = normCik(cik);
      if (!bare) return [];
      const padded = bare.padStart(10, "0");
      const raw = await getJson(`${SUBMISSIONS}/CIK${padded}.json`, {
        scope: "edgar.submissions",
        headers: { "user-agent": ua },
      });
      if (!raw || typeof raw !== "object") return [];
      const filings = (raw as Record<string, unknown>).filings as Record<string, unknown> | undefined;
      const recent = filings?.recent as Record<string, unknown> | undefined;
      if (!recent) return [];
      const accession = asArr(recent.accessionNumber);
      const form = asArr(recent.form);
      const filingDate = asArr(recent.filingDate);
      const primaryDoc = asArr(recent.primaryDocument);
      const want = new Set(formTypes.map((f) => f.toUpperCase()));
      const out: Filing[] = [];
      for (let i = 0; i < accession.length; i += 1) {
        const f = str(form[i]);
        if (!f || !want.has(f.toUpperCase())) continue;
        const acc = str(accession[i]);
        const date = str(filingDate[i]);
        if (!acc || !date) continue;
        const accNoDash = acc.replace(/-/g, "");
        const doc = str(primaryDoc[i]) ?? "";
        out.push({
          cik: bare,
          accession: acc,
          formType: f,
          filedAt: date,
          url: `https://www.sec.gov/Archives/edgar/data/${bare}/${accNoDash}/${doc}`,
          title: `${f} filing`,
        });
        if (out.length >= 20) break;
      }
      return out;
    },
  };
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
