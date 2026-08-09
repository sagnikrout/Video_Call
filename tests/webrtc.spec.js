const { test, expect } = require('@playwright/test');

test.describe('WebRTC Application Edge Cases & Diagnostics', () => {

  test('1. Core Signaling & Media Stream Handshake', async ({ context }) => {
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    await p1.goto('/');
    await p2.goto('/');

    await expect(p1.locator('#my-id-display')).not.toHaveText('Generating...', { timeout: 10000 });
    const id1 = await p1.locator('#my-id-display').textContent();

    await p2.click('#info-btn');
    await p2.fill('#remote-id-input', id1);
    await p2.click('#connect-btn');

    await expect(p2.locator('.status-badge')).toHaveText(/Connected/, { timeout: 15000 });
    await expect(p1.locator('.status-badge')).toHaveText(/Connected/, { timeout: 15000 });
    await expect(p2.locator('#upscale-canvas')).toBeVisible();
    
    // Disconnect from Caller
    await p2.click('#info-btn');
    await p2.click('#disconnect-btn');
    await expect(p2.locator('.status-badge')).toHaveText(/Call Ended/);
    await expect(p1.locator('.status-badge')).toHaveText(/Remote user disconnected/);
  });

  test('2. Error Handling: Invalid/Empty Peer ID', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#my-id-display')).not.toHaveText('Generating...', { timeout: 10000 });
    
    // Attempt empty connection
    await page.click('#info-btn');
    await page.click('#connect-btn');
    const toastEmpty = page.locator('.toast-item.toast-error').first();
    await expect(toastEmpty).toHaveText(/Please enter a valid Peer ID/);
    
    // Attempt invalid format/non-existent connection
    await page.fill('#remote-id-input', 'invalid-fake-id-12345');
    await page.click('#connect-btn');
    
    // UI should show connecting then fail or toast error
    const toastFail = page.locator('.toast-item.toast-error').nth(1);
    await expect(toastFail).toHaveText(/Could not connect to peer/, { timeout: 10000 });
  });

  test('3. Hardware Device Enumeration & Selection', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#my-id-display')).not.toHaveText('Generating...', { timeout: 10000 });

    // The fake media devices should populate the selects
    const micOptions = await page.locator('#mic-select option').count();
    const camOptions = await page.locator('#camera-select option').count();
    
    expect(micOptions).toBeGreaterThanOrEqual(1);
    expect(camOptions).toBeGreaterThanOrEqual(1);
  });

  test('4. Media Toggle State Machines (Mic/Cam)', async ({ page }) => {
    await page.goto('/');
    
    const micBtn = page.locator('#toggle-mic-btn');
    const camBtn = page.locator('#toggle-cam-btn');

    // Mute Mic
    await micBtn.click();
    await expect(micBtn).toHaveClass(/inactive/);
    await expect(page.locator('.toast-item.toast-warning').first()).toHaveText(/Microphone Muted/);

    // Disable Cam
    await camBtn.click();
    await expect(camBtn).toHaveClass(/inactive/);
    await expect(page.locator('.toast-item.toast-warning').nth(1)).toHaveText(/Camera Disabled/);

    // Re-enable
    await micBtn.click();
    await expect(micBtn).not.toHaveClass(/inactive/);
  });

  test('5. Quality Profile Switching (Bitrate constraints)', async ({ page }) => {
    await page.goto('/');
    
    const highBtn = page.locator('#btn-quality-high');
    const medBtn = page.locator('#btn-quality-medium');
    const lowBtn = page.locator('#btn-quality-low');

    // Default is medium
    await expect(medBtn).toHaveClass(/active/);

    // Switch to High
    await highBtn.click();
    await expect(highBtn).toHaveClass(/active/);
    await expect(medBtn).not.toHaveClass(/active/);
    await expect(page.locator('.toast-item.toast-info').last()).toHaveText(/Quality set to High/);

    // Switch to Low
    await lowBtn.click();
    await expect(lowBtn).toHaveClass(/active/);
    await expect(highBtn).not.toHaveClass(/active/);
  });

});
