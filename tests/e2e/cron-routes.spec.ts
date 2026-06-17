import { test, expect } from "@playwright/test";

// The cron + on-demand routes must reach their own handler (and fail closed), NOT be swallowed by the
// auth proxy into a /sign-in redirect. A bad/absent secret should get a 401 JSON, not a 3xx.

test("daily cron reaches the route and fails closed (401 JSON), not an auth redirect", async ({ request }) => {
  const res = await request.get("/api/cron/daily", {
    headers: { authorization: "Bearer wrong" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
  expect(res.headers()["content-type"]).toContain("application/json");
});

test("manual normalize drain is likewise reachable + fail-closed", async ({ request }) => {
  const res = await request.get("/api/normalize/drain", {
    headers: { authorization: "Bearer wrong" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
});

test("on-demand normalize/run is active-user gated (401 JSON for guests)", async ({ request }) => {
  const res = await request.post("/api/normalize/run", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(res.headers()["content-type"]).toContain("application/json");
});
