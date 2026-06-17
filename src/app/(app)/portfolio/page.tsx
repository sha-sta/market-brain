import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { PositionForm } from "./position-form";
import { deletePosition } from "./actions";

// Holdings + live P&L. Public companies value off the latest price snapshot; private companies off a
// manual valuation. This surfaces what the portfolio is worth + how concentrated it is — it never
// advises. requireActive bounces guests/pending users.
export const dynamic = "force-dynamic";

function money(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function pct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function pnlColor(n: number | null): string {
  if (n === null || n === 0) return "text-muted";
  return n > 0 ? "text-[#1a7f4b]" : "text-[#a32f2f]";
}

export default async function PortfolioPage() {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const { positions, allocation } = await getPortfolio(supabase, graphId);

  const totalPnL = positions.reduce((s, p) => s + (p.unrealizedPnL ?? 0), 0);
  const top = allocation.weights[0];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Portfolio</h1>
      <p className="mb-6 text-sm text-muted">What your names are worth today. MarketBrain surfaces — you decide.</p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded border border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Total value</div>
          <div className="text-xl font-semibold">{money(allocation.total)}</div>
        </div>
        <div className="rounded border border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Unrealized P&amp;L</div>
          <div className={`text-xl font-semibold ${pnlColor(totalPnL)}`}>{money(totalPnL)}</div>
        </div>
        <div className="rounded border border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Top concentration</div>
          <div className="text-xl font-semibold">
            {top ? `${(top.weight * 100).toFixed(0)}%` : "—"}
            {top && <span className="ml-1 text-sm font-normal text-muted">{top.title}</span>}
          </div>
        </div>
      </div>

      {top && top.weight >= 0.4 && (
        <p className="mb-6 rounded border border-border bg-[#f3efe6] p-3 text-sm">
          Concentration note: <strong>{top.title}</strong> is {(top.weight * 100).toFixed(0)}% of the portfolio's marked value.
        </p>
      )}

      <div className="mb-8 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3 font-normal">Holding</th>
              <th className="py-2 pr-3 font-normal">Shares</th>
              <th className="py-2 pr-3 font-normal">Day</th>
              <th className="py-2 pr-3 font-normal">Value</th>
              <th className="py-2 pr-3 font-normal">P&amp;L</th>
              <th className="py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  No holdings yet. Add one below, or let the seed + news populate your graph.
                </td>
              </tr>
            )}
            {positions.map((p) => (
              <tr key={p.nodeId} className="border-b border-border/60">
                <td className="py-2 pr-3">
                  <span className="font-medium">{p.title}</span>
                  {p.ticker && <span className="ml-1 text-muted">({p.ticker})</span>}
                  {!p.isPublic && <span className="ml-1 text-xs text-muted">private</span>}
                </td>
                <td className="py-2 pr-3 text-muted">{p.isPublic ? "" : "—"}</td>
                <td className={`py-2 pr-3 ${pnlColor(p.dayChangePct)}`}>{pct(p.dayChangePct)}</td>
                <td className="py-2 pr-3">{money(p.marketValue)}</td>
                <td className={`py-2 pr-3 ${pnlColor(p.unrealizedPnL)}`}>
                  {money(p.unrealizedPnL)}
                  {p.unrealizedPct !== null && <span className="ml-1 text-xs">({pct(p.unrealizedPct)})</span>}
                </td>
                <td className="py-2 text-right">
                  <form action={deletePosition}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="text-xs text-muted hover:text-[#a32f2f]" title="Remove holding">
                      remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PositionForm />
    </div>
  );
}
