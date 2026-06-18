import Link from "next/link";

// The strict-critic verdict panel for a thesis node: a calibrated strength badge, the mandatory bear
// case, thin-reasoning flags, and the confirming/challenging evidence (with verbatim quotes). Server
// component — pure render of the persisted data.judge block + the thesis's confirm/challenge edges.

const STRENGTH_COLOR: Record<string, string> = {
  unsupported: "#a32f2f",
  weak: "#a32f2f",
  contested: "#b8860b",
  supported: "#1a7f4b",
  "well-supported": "#1a7f4b",
};

export interface VerdictEvidence {
  id: string;
  title: string;
  quote: string | null;
}

export interface ThesisVerdictProps {
  strength: string;
  rationale?: string;
  bearCase?: string;
  thinFlags?: string[];
  confirming: VerdictEvidence[];
  challenging: VerdictEvidence[];
  judgedAt?: string;
}

function EvidenceList({ label, items }: { label: string; items: VerdictEvidence[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1">
      <h3 className="text-xs font-semibold text-muted">{label}</h3>
      <ul className="flex flex-col gap-0.5">
        {items.map((e) => (
          <li key={e.id} className="text-sm">
            <Link href={`/node/${e.id}`} className="hover:underline">
              {e.title}
            </Link>
            {e.quote && <span className="mt-0.5 block pl-3 text-xs italic text-muted">&ldquo;{e.quote}&rdquo;</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ThesisVerdict(props: ThesisVerdictProps) {
  const color = STRENGTH_COLOR[props.strength] ?? "#6b675f";
  return (
    <section className="mb-6 rounded border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Thesis check</h2>
        <span className="rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ color, borderColor: color }}>
          {props.strength}
        </span>
        <span className="text-xs text-muted">
          {props.confirming.length} for · {props.challenging.length} against
        </span>
      </div>
      {props.rationale && <p className="mb-2 text-sm">{props.rationale}</p>}
      {props.bearCase && (
        <p className="mb-2 text-sm">
          <span className="font-semibold">Bear case:</span> {props.bearCase}
        </p>
      )}
      {props.thinFlags && props.thinFlags.length > 0 && (
        <p className="mb-2 text-xs text-muted">Flags: {props.thinFlags.join(", ")}</p>
      )}
      <EvidenceList label="Confirming" items={props.confirming} />
      <EvidenceList label="Challenging" items={props.challenging} />
      {props.judgedAt && <p className="mt-2 text-xs text-muted">Judged {props.judgedAt.slice(0, 10)}</p>}
    </section>
  );
}
