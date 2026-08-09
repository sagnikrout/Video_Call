/**
 * Phase 1: Verification and Debugging Harness (debug.js)
 * 
 * Provides automated DOM validation, WebRTC media constraints interception,
 * RTCPeerConnection getStats() bitrate monitoring, and PeerJS connection verification.
 */

(function () {
    'use strict';

    console.log('%c[WebRTC Debug Harness] Initializing...', 'color: #3b82f6; font-weight: bold;');

    const REQUIRED_DOM_IDS = [
        'app-container',
        'video-container',
        'remote-video',
        'local-video',
        'control-panel',
        'my-id-display',
        'copy-id-btn',
        'remote-id-input',
        'connect-btn',
        'disconnect-btn',
        'connection-status',
        'quality-controls',
        'btn-quality-high',
        'btn-quality-medium',
        'btn-quality-low'
    ];

    const BITRATE_LIMITS_KBPS = {
        high: 4000,
        medium: 1500,
        low: 500
    };

    let statsIntervalId = null;
    let prevVideoBytesSent = 0;
    let prevAudioBytesSent = 0;
    let prevTimestamp = 0;
    let violationDurationMs = 0;

    /**
     * 1. DOM Verification Module
     * Inspects document for all mandated element IDs and reports missing targets.
     */
    function verifyDOM() {
        console.group('[WebRTC Debug] 1. DOM Element Verification');
        let allValid = true;
        
        REQUIRED_DOM_IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                console.log(`✓ Element #${id} found (${el.tagName})`);
            } else {
                console.error(`✗ MISSING MANDATED DOM ELEMENT: #${id}`);
                allValid = false;
            }
        });

        if (allValid) {
            console.log('%c✓ All 15 required DOM elements verified successfully.', 'color: #10b981; font-weight: bold;');
        } else {
            console.warn('%c⚠ Missing DOM elements detected. Check markup.', 'color: #ef4444; font-weight: bold;');
        }
        console.groupEnd();
        return allValid;
    }

    /**
     * 2. Media Constraints Interceptor
     * Intercepts quality button clicks and logs live resolution & frameRate settings.
     */
    function setupMediaConstraintsInterceptor() {
        console.group('[WebRTC Debug] 2. Media Constraints Interceptor');
        
        const interceptQualityButton = (btnId, levelName) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;

            btn.addEventListener('click', () => {
                setTimeout(() => {
                    if (typeof localStream !== 'undefined' && localStream && localStream.getVideoTracks().length > 0) {
                        const videoTrack = localStream.getVideoTracks()[0];
                        const settings = videoTrack.getSettings();
                        const constraints = videoTrack.getConstraints();

                        console.group(`[Debug Interceptor] Quality Switched to: ${levelName.toUpperCase()}`);
                        console.log(`Applied Settings -> Width: ${settings.width}px, Height: ${settings.height}px, FrameRate: ${settings.frameRate}fps`);
                        console.log(`Target Constraints ->`, constraints);
                        console.groupEnd();
                    } else {
                        console.warn(`[Debug Interceptor] Clicked ${levelName}, but localStream is not active.`);
                    }
                }, 300);
            });
        };

        interceptQualityButton('btn-quality-high', 'High');
        interceptQualityButton('btn-quality-medium', 'Medium');
        interceptQualityButton('btn-quality-low', 'Low');

        console.log('✓ Media constraints interceptor attached to quality control buttons.');
        console.groupEnd();
    }

    /**
     * 3. Bitrate Verification & getStats() Monitoring Loop
     * Polls RTCPeerConnection stats every second and issues warnings if outbound bitrate
     * exceeds target thresholds for longer than 5 seconds.
     */
    function startBitrateMonitor() {
        if (statsIntervalId) clearInterval(statsIntervalId);

        console.log('[WebRTC Debug] 3. Starting RTCPeerConnection getStats() Bitrate Monitor...');

        statsIntervalId = setInterval(async () => {
            if (typeof currentCall === 'undefined' || !currentCall || !currentCall.peerConnection) {
                violationDurationMs = 0;
                return;
            }

            const pc = currentCall.peerConnection;
            if (pc.connectionState !== 'connected' && pc.iceConnectionState !== 'connected') {
                return;
            }

            try {
                const stats = await pc.getStats();
                let currentVideoBytesSent = 0;
                let currentAudioBytesSent = 0;
                let currentTimestamp = 0;

                stats.forEach((report) => {
                    if (report.type === 'outbound-rtp') {
                        if (report.kind === 'video' || report.mediaType === 'video') {
                            currentVideoBytesSent = report.bytesSent || 0;
                            currentTimestamp = report.timestamp;
                        } else if (report.kind === 'audio' || report.mediaType === 'audio') {
                            currentAudioBytesSent = report.bytesSent || 0;
                        }
                    }
                });

                if (prevTimestamp > 0 && currentTimestamp > prevTimestamp) {
                    const timeDeltaSec = (currentTimestamp - prevTimestamp) / 1000;
                    
                    // Calculate outbound video bitrate in kbps (bytes * 8 / 1000 / seconds)
                    const videoBitrateKbps = Math.round(((currentVideoBytesSent - prevVideoBytesSent) * 8) / (1000 * timeDeltaSec));
                    const audioBitrateKbps = Math.round(((currentAudioBytesSent - prevAudioBytesSent) * 8) / (1000 * timeDeltaSec));

                    const activeQuality = (typeof currentQuality !== 'undefined') ? currentQuality : 'medium';
                    const maxAllowedKbps = BITRATE_LIMITS_KBPS[activeQuality] || 1500;

                    console.log(`[Bitrate Monitor] Mode: ${activeQuality.toUpperCase()} | Outbound Video: ${videoBitrateKbps} kbps | Audio: ${audioBitrateKbps} kbps (Limit: ${maxAllowedKbps} kbps)`);

                    // Bitrate violation detection (> 5 seconds)
                    if (videoBitrateKbps > maxAllowedKbps) {
                        violationDurationMs += (timeDeltaSec * 1000);
                        if (violationDurationMs >= 5000) {
                            console.warn(`%c⚠ BITRATE EXCEEDED WARNING: Outbound video bitrate (${videoBitrateKbps} kbps) exceeded enforced limit (${maxAllowedKbps} kbps) for ${(violationDurationMs / 1000).toFixed(1)}s!`, 'color: #ef4444; font-weight: bold; font-size: 1.1em;');
                        }
                    } else {
                        violationDurationMs = 0;
                    }
                }

                prevVideoBytesSent = currentVideoBytesSent;
                prevAudioBytesSent = currentAudioBytesSent;
                prevTimestamp = currentTimestamp;

            } catch (err) {
                console.error('[Bitrate Monitor] Error fetching stats:', err);
            }
        }, 1000);
    }

    /**
     * 4. PeerJS Connection & Error Handling Diagnostic Check
     */
    function verifyPeerJSConnection() {
        console.group('[WebRTC Debug] 4. PeerJS Connection & Signaling Check');
        
        if (typeof peer !== 'undefined' && peer) {
            if (peer.id) {
                console.log(`✓ PeerJS active with assigned Peer ID: ${peer.id}`);
            } else {
                console.log('⌛ PeerJS initialized, waiting for assigned ID...');
            }

            console.log('✓ Testing peer error handler responsiveness...');
            // Inject test listener check
            const hasErrorListener = peer.listeners('error').length > 0;
            if (hasErrorListener) {
                console.log('✓ peer.on("error") handler is actively registered.');
            } else {
                console.warn('⚠ No peer.on("error") listener registered!');
            }
        } else {
            console.error('✗ PeerJS instance not found in global scope.');
        }
        console.groupEnd();
    }

    // Run verification routines after DOM loaded
    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            verifyDOM();
            setupMediaConstraintsInterceptor();
            startBitrateMonitor();
            verifyPeerJSConnection();
        }, 1000);
    });

    // Expose debug tools on global window object
    window.debugHarness = {
        runDomCheck: verifyDOM,
        startBitrateMonitor: startBitrateMonitor,
        verifyPeerJS: verifyPeerJSConnection
    };

})();
