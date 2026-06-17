import { test, expect } from "@playwright/test";

// The proxy login gate against the running app + local Supabase. Authenticated flows (Google sign-in,
// pending screen) need the Google provider configured and are verified manually.

test("guest hitting home is redirected to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("guest cannot reach the gated app pages", async ({ page }) => {
  for (const path of ["/dump", "/portfolio", "/brief", "/ask"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in/);
  }
});

test("sign-in page renders the Google button", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: /sign in with google/i })).toBeVisible();
});
