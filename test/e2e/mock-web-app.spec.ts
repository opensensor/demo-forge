import { test, expect } from "@playwright/test";

test.describe("Mock Web App — Pages", () => {
  test("home page loads with correct title", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#page-title")).toHaveText("DemoForge Mock App");
    await expect(page.locator("#nav-login")).toBeVisible();
    await expect(page.locator("#nav-dashboard")).toBeVisible();
    await expect(page.locator("#nav-form")).toBeVisible();
  });

  test("login page loads with correct elements", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#page-title")).toHaveText("Sign In");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#sign-in-btn")).toBeVisible();
  });

  test("login form fills and navigates to dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "user@example.com");
    await page.fill("#password", "password123");
    await page.click("#sign-in-btn");
    await page.waitForURL(/\/dashboard/);
    await expect(page.locator("#page-title")).toHaveText("Dashboard");
  });

  test("dashboard loads with metrics", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("#page-title")).toHaveText("Dashboard");
    await expect(page.locator("#welcome-heading")).toBeVisible();
    await expect(page.locator("#total-users")).toBeVisible();
    await expect(page.locator("#active-sessions")).toBeVisible();
    await expect(page.locator("#revenue")).toBeVisible();
    await expect(page.locator("#growth")).toBeVisible();
  });

  test("form page loads with correct elements", async ({ page }) => {
    await page.goto("/form");
    await expect(page.locator("#page-title")).toHaveText("Contact Form");
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#subject")).toBeVisible();
    await expect(page.locator("#message")).toBeVisible();
    await expect(page.locator("#submit-btn")).toBeVisible();
  });

  test("form submission shows success message", async ({ page }) => {
    await page.goto("/form");
    await page.fill("#name", "Jane Doe");
    await page.fill("#email", "jane@example.com");
    await page.selectOption("#subject", "General Inquiry");
    await page.fill("#message", "Test message");
    await page.click("#submit-btn");
    await expect(page.locator("#success-view")).toBeVisible();
    await expect(page.locator("#success-view h2")).toHaveText("Thank you!");
  });

  test("navigation links work between pages", async ({ page }) => {
    await page.goto("/");
    await page.click("#nav-login");
    await expect(page.locator("#page-title")).toHaveText("Sign In");
    await page.fill("#email", "user@example.com");
    await page.fill("#password", "password123");
    await page.click("#sign-in-btn");
    await page.waitForURL(/\/dashboard/);
    await page.click("text=Contact Form");
    await expect(page.locator("#page-title")).toHaveText("Contact Form");
    await page.goto("/");
    await expect(page.locator("#page-title")).toHaveText("DemoForge Mock App");
  });
});
