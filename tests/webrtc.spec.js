const { test, expect } = require('@playwright/test');

test.describe('WebRTC P2P Video Call', () => {
  test('Should successfully connect two peers and stream video', async ({ context }) => {
    // 1. Setup two isolated pages
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // 2. Open the app in both pages
    await page1.goto('/');
    await page2.goto('/');

    // 3. Wait for both peers to connect to PeerJS server and generate IDs
    await expect(page1.locator('#my-id-display')).not.toHaveText('Generating...', { timeout: 10000 });
    await expect(page2.locator('#my-id-display')).not.toHaveText('Generating...', { timeout: 10000 });

    const id1 = await page1.locator('#my-id-display').textContent();
    const id2 = await page2.locator('#my-id-display').textContent();

    console.log(`Peer 1 ID: ${id1}`);
    console.log(`Peer 2 ID: ${id2}`);

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();

    // 4. Have Page 2 call Page 1
    await page2.fill('#remote-id-input', id1);
    await page2.click('#connect-btn');

    // 5. Verify UI status badges change to "Connected"
    await expect(page2.locator('.status-badge')).toHaveText(/Connected/, { timeout: 15000 });
    await expect(page1.locator('.status-badge')).toHaveText(/Connected/, { timeout: 15000 });

    // 6. Verify that remote video starts playing (canvas is visible)
    await expect(page2.locator('#upscale-canvas')).toBeVisible();
    await expect(page1.locator('#upscale-canvas')).toBeVisible();
    
    // 7. Verify the call disconnects properly
    await page2.click('#disconnect-btn');
    await expect(page2.locator('.status-badge')).toHaveText(/Call Ended/);
    await expect(page1.locator('.status-badge')).toHaveText(/Remote user disconnected/);
  });
});
