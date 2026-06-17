// Per-type node tints for the home force graph. Muted, warm earth tones tuned to read on the
// #FAF9F6 paper background without shouting — the graph should stay calm and editorial, not turn
// into a candy-colored dashboard. Unknown types fall back to the off-black foreground.

export const FG = "#1c1b19"; // off-black foreground / fallback for unrecognized types

const NODE_TYPE_COLOR: Record<string, string> = {
  company: "#4f5b6e", // slate blue — the anchor entities
  person: "#7a5c3e", // warm brown
  sector: "#3f6b66", // deep teal
  theme: "#6e5470", // muted plum
  news: "#8a6d3b", // ochre — the daily inflow
  filing: "#5c6e57", // muted sage
  thesis: "#7a4a4a", // muted brick — his own convictions stand out
  note: "#5a5750", // warm gray — keep notes recessive
};

export function nodeColorForType(type: string): string {
  return NODE_TYPE_COLOR[type] ?? FG;
}
