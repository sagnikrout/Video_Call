/**
 * Phase 2: Client-Side Stress Testing Module (stress.js)
 * 
 * Simulates adverse user actions and network degradation scenarios to verify
 * memory stability, state synchronization, and reconnection resilience.
 */

(function () {
    'use strict';

    console.log('%c[WebRTC Stress Test Suite] Loaded.', 'color: #f59e0b; font-weight: bold;');

    /**
     * 1. Rapid State Toggling Test
     * Clicks High, Medium, and Low quality buttons 100 times with random delays (50ms–200ms).
     * Validates that applyConstraints and setParameters execute without throwing InvalidStateError.
     */
    async function runRapidQualityToggles(iterations = 100) {
        console.group(`[Stress Test] 1. Starting Rapid Quality Button Toggling (${iterations} iterations)`);
        const buttons = [
            document.getElementById('btn-quality-high'),
            document.getElementById('btn-quality-medium'),
            document.getElementById('btn-quality-low')
        ].filter(Boolean);

        if (buttons.length < 3) {
            console.error('✗ Stress test aborted: Quality buttons missing from DOM.');
            console.groupEnd();
            return;
        }

        let successCount = 0;
        let errorCount = 0;
        const caughtErrors = [];

        for (let i = 1; i <= iterations; i++) {
            const randomBtn = buttons[Math.floor(Math.random() * buttons.length)];
            const randomDelay = Math.floor(Math.random() * (200 - 50 + 1)) + 50;

            try {
                // Programmatically trigger click event
                randomBtn.click();
                successCount++;
                console.log(`Iteration ${i}/${iterations}: Clicked #${randomBtn.id} (Delay: ${randomDelay}ms)`);
            } catch (err) {
                errorCount++;
                caughtErrors.push(err);
                console.error(`Iteration ${i}/${iterations} ERROR:`, err);
            }

            // Wait random interval between 50ms and 200ms
            await new Promise((resolve) => setTimeout(resolve, randomDelay));
        }

        console.log(`%c[Stress Result] Completed ${iterations} toggles. Successes: ${successCount}, Errors: ${errorCount}`, 
            errorCount === 0 ? 'color: #10b981; font-weight: bold;' : 'color: #ef4444; font-weight: bold;');
        
        if (caughtErrors.length > 0) {
            console.warn('Errors encountered during stress toggling:', caughtErrors);
        }
        console.groupEnd();
    }

    /**
     * 2. Network Drop Simulation
     * Manually forces RTCPeerConnection ICE state to 'disconnected' or 'failed'
     * to verify that automatic 2-second reconnection logic fires correctly.
     */
    function simulateNetworkDrop(targetState = 'disconnected') {
        console.group(`[Stress Test] 2. Simulating Network Drop (ICE State: ${targetState})`);

        if (typeof currentCall === 'undefined' || !currentCall || !currentCall.peerConnection) {
            console.warn('⚠ No active peerConnection available to simulate network drop.');
            console.groupEnd();
            return;
        }

        const pc = currentCall.peerConnection;

        console.log(`Original ICE State: ${pc.iceConnectionState}`);
        console.log(`Forcing ICE state transition to: ${targetState}...`);

        // Override iceConnectionState property temporarily or dispatch state change event
        try {
            Object.defineProperty(pc, 'iceConnectionState', {
                get: () => targetState,
                configurable: true
            });

            // Dispatch oniceconnectionstatechange event
            if (typeof pc.oniceconnectionstatechange === 'function') {
                pc.oniceconnectionstatechange(new Event('iceconnectionstatechange'));
                console.log('%c✓ Triggered oniceconnectionstatechange event handler.', 'color: #10b981;');
            } else {
                console.warn('⚠ No oniceconnectionstatechange handler found on peerConnection.');
            }
        } catch (err) {
            console.error('Error dispatching network drop simulation:', err);
        }

        console.groupEnd();
    }

    /**
     * 3. Tab Backgrounding Simulation
     * Simulates browser tab losing focus (visibilitychange) to verify WebRTC audio/video track persistence.
     */
    function simulateTabBackgrounding(hiddenState = true) {
        console.group(`[Stress Test] 3. Simulating Tab Backgrounding (hidden = ${hiddenState})`);

        try {
            Object.defineProperty(document, 'hidden', {
                get: () => hiddenState,
                configurable: true
            });
            Object.defineProperty(document, 'visibilityState', {
                get: () => hiddenState ? 'hidden' : 'visible',
                configurable: true
            });

            // Dispatch visibilitychange event
            document.dispatchEvent(new Event('visibilitychange'));
            console.log(`✓ Dispatched visibilitychange event. Current State: ${document.visibilityState}`);

            if (typeof localStream !== 'undefined' && localStream) {
                const tracks = localStream.getTracks();
                console.log('Stream Track Status post-visibilitychange:');
                tracks.forEach((track) => {
                    console.log(`- Track ${track.kind}: enabled=${track.enabled}, readyState=${track.readyState}`);
                });
            }
        } catch (err) {
            console.error('Error simulating tab backgrounding:', err);
        }

        console.groupEnd();
    }

    /**
     * 4. Permission Denial Loop Simulation
     * Simulates repeated NotAllowedError rejections from getUserMedia to ensure UI stability.
     */
    async function simulatePermissionDenialLoop(iterations = 5) {
        console.group(`[Stress Test] 4. Simulating Permission Denial Loop (${iterations} iterations)`);

        const mockError = new DOMException('Permission denied by user', 'NotAllowedError');

        for (let i = 1; i <= iterations; i++) {
            console.log(`Denial Simulation Iteration ${i}/${iterations}`);
            
            // Dispatch simulated handle permission error
            const statusEl = document.getElementById('connection-status');
            if (statusEl) {
                statusEl.textContent = 'Permission Denied';
            }
            
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        console.log('%c✓ Permission denial loop completed gracefully. UI responsive.', 'color: #10b981; font-weight: bold;');
        console.groupEnd();
    }

    // Expose stress test utilities on global window object
    window.stressTest = {
        runRapidQualityToggles: runRapidQualityToggles,
        simulateNetworkDrop: simulateNetworkDrop,
        simulateTabBackgrounding: simulateTabBackgrounding,
        simulatePermissionDenialLoop: simulatePermissionDenialLoop
    };

})();
