import { test, expect } from '@playwright/test';

test('login page renders the MaintAI product', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.getByText('See failures before they stop production.')).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});
