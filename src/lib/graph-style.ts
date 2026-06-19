// Per-type node tints for the home force graph. Muted tones lifted to read on the dark charcoal
// (#0F1113) background without shouting — the graph should stay calm, not turn into a candy-colored
// dashboard. Unknown types fall back to the soft-white foreground.

export const FG = "#ececed"; // soft-white foreground / fallback for unrecognized types

const NODE_TYPE_COLOR: Record<string, string> = {
  company: "#8fa6c4", // slate blue — the anchor entities
  person: "#c39a6b", // warm sand
  sector: "#6fb3aa", // teal
  theme: "#b491b6", // plum
  news: "#d6b46a", // ochre — the daily inflow
  filing: "#9bb592", // sage
  thesis: "#cf8a86", // brick — his own convictions stand out
  note: "#a8a39a", // warm gray — keep notes recessive
};

export function nodeColorForType(type: string): string {
  return NODE_TYPE_COLOR[type] ?? FG;
}
