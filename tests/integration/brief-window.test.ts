import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, TEST_GRAPH_ID } from "./_helpers";
import { gatherBrief } from "@/server/digest/gather";

// The morning brief only surfaces news published AFTER the previous market close (4:30pm ET), so the
// 7am brief is the after-hours + overnight delta rather than intraday news the reader already saw.

const admin = adminClient();
const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;

async function seedNews(id: string, headline: string, publishedAt: string): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type: "news",
    title: headline,
    status: "active",
    data: { headline, url: `https://example.com/${id}`, source: "Wire", published_at: publishedAt },
    tags: [],
    embedding: ZERO_VEC,
    lifecycle: "active",
  });
  if (error) throw new Error(`seedNews: ${error.message}`);
}

describe("brief news window — only after the previous market close", () => {
  beforeAll(async () => {
    await cleanupAll();
    // A Tue ~7am ET run => previous close is Mon Jul 6 2026 16:30 ET (20:30 UTC).
    await seedNews("after-close", "AfterHours beat", "2026-07-06T22:00:00Z"); // Mon 6pm ET — post-close
    await seedNews("intraday", "Intraday chatter", "2026-07-06T17:00:00Z"); // Mon 1pm ET — pre-close
  });
  afterAll(cleanupAll);

  it("includes post-close news and excludes intraday news", async () => {
    const nowMs = Date.UTC(2026, 6, 7, 11, 0); // Tue Jul 7 2026, ~7am ET
    const data = await gatherBrief(admin, TEST_GRAPH_ID, {
      date: "2026-07-07",
      // Far enough back that the rows' real created_at passes; only the market-close cut should bite.
      sinceIso: "2020-01-01T00:00:00Z",
      nowMs,
    });
    const headlines = data.news.map((n) => n.headline);
    expect(headlines).toContain("AfterHours beat");
    expect(headlines).not.toContain("Intraday chatter");
  });
});
