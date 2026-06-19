import { afterEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, TEST_GRAPH_ID } from "./_helpers";
import { writeNodeData } from "@/server/normalize/upsert";
import { searchNodes } from "@/lib/graph";
import type { Json } from "@/lib/database.types";

// The manual living-graph control path the node-editor actions use (writeNodeData with reason 'manual'
// / 'archive'): a correction snapshots a revision + re-embeds; an archive hides the node from search.

const admin = adminClient();
const ZERO = new Array(1536).fill(0) as number[];
const asJson = (v: unknown): Json => v as Json;
const asObj = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

async function seedCompany(id: string, data: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type: "company",
    title: String(data.name ?? id),
    status: "mentioned",
    data: asJson(data),
    tags: [],
    embedding: `[${ZERO.join(",")}]`,
    lifecycle: "active",
  });
  if (error) throw new Error(`seed: ${error.message}`);
}

describe("manual node edit", () => {
  afterEach(cleanupAll);

  it("editing a narrative field snapshots a 'manual' revision and re-embeds", async () => {
    await cleanupAll();
    await seedCompany("acme", { name: "Acme", description: "old description of acme" });
    let embedCalls = 0;
    const embed = async (): Promise<number[]> => {
      embedCalls += 1;
      return ZERO;
    };

    const res = await writeNodeData(
      admin,
      TEST_GRAPH_ID,
      "acme",
      { data: { name: "Acme", description: "new accelerator-focused description" } },
      { embed, prior: { type: "company", title: "Acme", status: "mentioned", data: { name: "Acme", description: "old description of acme" } }, reason: "manual", snapshot: true },
    );
    expect(res.reembedded).toBe(true); // description is an embedded field -> re-embed
    expect(embedCalls).toBe(1);

    const { data: node } = await admin.from("nodes").select("data").eq("graph_id", TEST_GRAPH_ID).eq("id", "acme").single();
    expect(asObj(node!.data).description).toBe("new accelerator-focused description");

    const { data: revs } = await admin.from("node_revisions").select("reason, prior_data").eq("graph_id", TEST_GRAPH_ID).eq("node_id", "acme");
    expect(revs!.length).toBe(1);
    expect(revs![0].reason).toBe("manual");
    expect(asObj(revs![0].prior_data).description).toBe("old description of acme");
  });

  it("archiving hides the node from search and records an 'archive' revision", async () => {
    await cleanupAll();
    await seedCompany("acme", { name: "Acme Searchable", description: "x" });
    // visible before archive
    const before = await searchNodes(admin, "Acme Searchable", TEST_GRAPH_ID);
    expect(before.map((n) => n.id)).toContain("acme");

    await writeNodeData(
      admin,
      TEST_GRAPH_ID,
      "acme",
      { lifecycle: "archived" },
      { prior: { type: "company", title: "Acme Searchable", status: "mentioned", data: { name: "Acme Searchable" } }, reason: "archive", snapshot: true },
    );

    const { data: node } = await admin.from("nodes").select("lifecycle").eq("graph_id", TEST_GRAPH_ID).eq("id", "acme").single();
    expect(node!.lifecycle).toBe("archived");
    const after = await searchNodes(admin, "Acme Searchable", TEST_GRAPH_ID);
    expect(after.map((n) => n.id)).not.toContain("acme"); // hidden from default search
    const { data: revs } = await admin.from("node_revisions").select("reason").eq("graph_id", TEST_GRAPH_ID).eq("node_id", "acme");
    expect(revs!.map((r) => r.reason)).toContain("archive");
  });
});
