import { describe, it, expect } from "vitest";
import { exaClient, isPublicHttpUrl } from "@/server/market/websearch";
import { stripHtml } from "@/server/market/http";

describe("isPublicHttpUrl — SSRF guard", () => {
  it("allows public http(s) URLs", () => {
    expect(isPublicHttpUrl("https://reuters.com/x")).toBe(true);
    expect(isPublicHttpUrl("http://example.com")).toBe(true);
  });
  it("blocks non-http schemes, loopback, private, link-local, and metadata", () => {
    expect(isPublicHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isPublicHttpUrl("http://localhost:54321")).toBe(false);
    expect(isPublicHttpUrl("http://127.0.0.1/")).toBe(false);
    expect(isPublicHttpUrl("http://10.0.0.5/")).toBe(false);
    expect(isPublicHttpUrl("http://192.168.1.1/")).toBe(false);
    expect(isPublicHttpUrl("http://172.16.0.1/")).toBe(false);
    expect(isPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).toBe(false); // cloud metadata
    expect(isPublicHttpUrl("http://service.internal/")).toBe(false);
    expect(isPublicHttpUrl("not a url")).toBe(false);
    // Raw IPv6 literals are blocked wholesale — incl. loopback and the IPv4-mapped metadata bypass.
    expect(isPublicHttpUrl("http://[::1]/")).toBe(false);
    expect(isPublicHttpUrl("http://[::ffff:169.254.169.254]/latest/meta-data/")).toBe(false);
    expect(isPublicHttpUrl("https://[2606:4700::1111]/")).toBe(false);
  });
});

describe("exaClient — dormant without a key", () => {
  it("returns [] from search and null from a blocked fetchArticle when EXA_API_KEY is unset", async () => {
    delete process.env.EXA_API_KEY; // unset for this test
    const client = exaClient();
    expect(await client.search("nvidia HBM supply")).toEqual([]);
    expect(await client.fetchArticle("http://127.0.0.1/secret")).toBeNull(); // SSRF-blocked regardless
  });
});

describe("stripHtml", () => {
  it("drops scripts/styles/tags and collapses whitespace", () => {
    const html = "<html><head><style>.a{}</style></head><body><script>steal()</script><p>Hello   world</p></body></html>";
    const text = stripHtml(html);
    expect(text).toBe("Hello world");
    expect(text).not.toContain("steal");
  });
});
