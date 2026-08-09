/**
 * Peer-to-Peer WebRTC Video Calling Application - Production Hardened
 * Built with HTML5, CSS3, Vanilla JavaScript, WebRTC, and PeerJS.
 */

// ==========================================
// Global Application State & DOM Selectors
// ==========================================
let peer = null;                // PeerJS instance
let currentCall = null;         // Active PeerJS MediaConnection call object
let localStream = null;         // Local MediaStream (Camera & Microphone)
let currentQuality = 'medium';  // Default stream quality ('high' | 'medium' | 'low')
let remotePeerId = '';          // Stores the remote peer ID for call management / reconnection
let reconnectTimeoutId = null;  // Timer reference for ICE auto-reconnect attempts

// Mutex / Queue to prevent concurrent setParameters calls and InvalidStateError race conditions
let qualityChangeQueue = Promise.resolve();

// Audio/Video Track Mute States
let isMicMuted = false;
let isCamOff = false;

// Quality Preset Definitions (Resolution, Frame Rate, Video Bitrate, Audio Bitrate)
const QUALITY_PRESETS = {
    high: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        videoMaxBitrate: 4000000, // 4.0 Mbps
        audioMaxBitrate: 128000   // 128 kbps
    },
    medium: {
        width: 1280,
        height: 720,
        frameRate: 30,
        videoMaxBitrate: 1500000, // 1.5 Mbps
        audioMaxBitrate: 64000    // 64 kbps
    },
    low: {
        width: 854,
        height: 480,
        frameRate: 15,
        videoMaxBitrate: 500000,  // 500 kbps
        audioMaxBitrate: 32000    // 32 kbps
    }
};

// DOM Element References
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const myIdDisplay = document.getElementById('my-id-display');
const copyIdBtn = document.getElementById('copy-id-btn');
const remoteIdInput = document.getElementById('remote-id-input');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const connectionStatus = document.getElementById('connection-status');
const statusBadge = document.querySelector('.status-badge');
const remoteVideoPlaceholder = document.getElementById('remote-video-placeholder');

const btnQualityHigh = document.getElementById('btn-quality-high');
const btnQualityMedium = document.getElementById('btn-quality-medium');
const btnQualityLow = document.getElementById('btn-quality-low');

const micToggleBtn = document.getElementById('mic-toggle-btn');
const camToggleBtn = document.getElementById('cam-toggle-btn');
const toastContainer = document.getElementById('toast-container');

// ==========================================
// Initialization & Hardware Permission Logic
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initializeApplication();
});

/**
 * Main initialization workflow: setup PeerJS connection, UI event listeners, and media capture.
 */
async function initializeApplication() {
    setupEventListeners();
    initializePeer();
    await requestMediaPermissions();
}

/**
 * Instantiates the PeerJS object with public Google STUN servers for robust NAT traversal.
 */
function initializePeer() {
    updateStatus('Connecting to signaling server...', 'warning');
    
    // Configure PeerJS with reliable public STUN servers for NAT/Firewall traversal
    peer = new Peer({
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });

    // Event 1: Assigned a unique Peer ID by the signaling server
    peer.on('open', (id) => {
        console.log('PeerJS server connection established. Local ID:', id);
        myIdDisplay.textContent = id;
        updateStatus('Awaiting Connection', 'warning');
        showToast('Connected to signaling server', 'success');
    });

    // Event 2: Listen for incoming calls from remote peers
    peer.on('call', (incomingCall) => {
        console.log('Incoming call received from:', incomingCall.peer);
        showToast(`Incoming call from ${incomingCall.peer.substring(0, 8)}...`, 'info');
        handleIncomingCall(incomingCall);
    });

    // Event 3: Scenario - PeerJS signaling server disconnects
    peer.on('disconnected', () => {
        console.warn('Disconnected from PeerJS signaling server. Attempting reconnection...');
        updateStatus('Reconnecting to server...', 'warning');
        showToast('Signaling server disconnected. Reconnecting...', 'warning');
        // Re-establish connection to the signaling server
        peer.reconnect();
    });

    // Event 4: PeerJS Error Handling
    peer.on('error', (err) => {
        console.error('PeerJS error encountered:', err);
        if (err.type === 'peer-unavailable') {
            showToast(`Peer ID "${remoteIdInput.value.trim()}" is not available or offline.`, 'error');
            updateStatus('Peer Unavailable', 'disconnected');
        } else {
            showToast(`Signaling Error: ${err.type}`, 'error');
            updateStatus(`Error: ${err.type}`, 'disconnected');
        }
    });
}

/**
 * Requests user hardware access (Camera and Microphone) via getUserMedia.
 */
async function requestMediaPermissions() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: QUALITY_PRESETS.medium.width },
                height: { ideal: QUALITY_PRESETS.medium.height },
                frameRate: { ideal: QUALITY_PRESETS.medium.frameRate }
            },
            audio: true
        });

        // Scenario: User grants permission
        localStream = stream;
        localVideo.srcObject = stream;
        
        // Default the quality state to "Medium"
        await setMediaQuality('medium');
        console.log('Media permissions granted and local stream attached.');

    } catch (error) {
        console.error('getUserMedia Error:', error);
        
        // Scenario: User denies permission (NotAllowedError)
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            showToast('Camera and microphone permissions were denied.', 'error');
            updateStatus('Permission Denied', 'disconnected');
        }
        // Scenario: Hardware missing (NotFoundError)
        else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            showToast('No camera or microphone was detected on your device.', 'error');
            updateStatus('Hardware Not Found', 'disconnected');
        }
        else {
            showToast(`Unable to access camera/microphone: ${error.message}`, 'error');
            updateStatus('Media Error', 'disconnected');
        }
    }
}

// ==========================================
// Event Listeners & Control Handlers
// ==========================================
function setupEventListeners() {
    // Copy Peer ID to clipboard with robust fallback
    copyIdBtn.addEventListener('click', () => {
        const idText = myIdDisplay.textContent;
        if (idText && idText !== 'Generating ID...') {
            copyTextToClipboard(idText);
        }
    });

    // Initiate call on button click
    connectBtn.addEventListener('click', () => {
        const remoteId = remoteIdInput.value.trim();
        if (!remoteId) {
            showToast('Please enter a valid remote Peer ID to call.', 'warning');
            return;
        }
        if (peer && remoteId === peer.id) {
            showToast('You cannot call your own Peer ID!', 'warning');
            return;
        }
        initiateCall(remoteId);
    });

    // Terminate call on button click
    disconnectBtn.addEventListener('click', () => {
        hangUpCall('Call Ended');
    });

    // Quality Control Buttons
    btnQualityHigh.addEventListener('click', () => setMediaQuality('high'));
    btnQualityMedium.addEventListener('click', () => setMediaQuality('medium'));
    btnQualityLow.addEventListener('click', () => setMediaQuality('low'));

    // Audio & Video Mute Toggle Buttons
    if (micToggleBtn) {
        micToggleBtn.addEventListener('click', toggleMic);
    }
    if (camToggleBtn) {
        camToggleBtn.addEventListener('click', toggleCamera);
    }
}

/**
 * Toggles local audio microphone track state (Mute / Unmute).
 */
function toggleMic() {
    if (!localStream || localStream.getAudioTracks().length === 0) return;
    const audioTrack = localStream.getAudioTracks()[0];
    isMicMuted = !isMicMuted;
    audioTrack.enabled = !isMicMuted;

    if (isMicMuted) {
        micToggleBtn.classList.add('muted');
        micToggleBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg> Mic Off
        `;
        showToast('Microphone muted', 'info');
    } else {
        micToggleBtn.classList.remove('muted');
        micToggleBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg> Mic On
        `;
        showToast('Microphone unmuted', 'info');
    }
}

/**
 * Toggles local camera video track state (Video On / Off).
 */
function toggleCamera() {
    if (!localStream || localStream.getVideoTracks().length === 0) return;
    const videoTrack = localStream.getVideoTracks()[0];
    isCamOff = !isCamOff;
    videoTrack.enabled = !isCamOff;

    if (isCamOff) {
        camToggleBtn.classList.add('muted');
        camToggleBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg> Cam Off
        `;
        showToast('Camera video disabled', 'info');
    } else {
        camToggleBtn.classList.remove('muted');
        camToggleBtn.innerHTML = `
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="23 7 16 12 23 17 23 7"></polygon>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg> Cam On
        `;
        showToast('Camera video enabled', 'info');
    }
}

// ==========================================
// Call Lifecycle Management
// ==========================================

/**
 * Outgoing call scenario: Calls the remote peer and hooks into stream/event listeners.
 */
function initiateCall(remoteId) {
    if (!localStream) {
        showToast('Local media stream is not ready. Please enable camera access.', 'warning');
        return;
    }

    remotePeerId = remoteId;
    updateStatus('Connecting...', 'warning');

    console.log(`Initiating outgoing call to peer: ${remoteId}`);
    const call = peer.call(remoteId, localStream);
    setupCallEvents(call);
}

/**
 * Incoming call scenario: Answers incoming call with local stream and hooks into event listeners.
 */
function handleIncomingCall(call) {
    remotePeerId = call.peer;
    remoteIdInput.value = call.peer;

    // Automatically answer incoming call with local stream
    call.answer(localStream);
    setupCallEvents(call);
}

/**
 * Sets up listeners for stream, close, error, and ICE connection state changes on a call.
 */
function setupCallEvents(call) {
    currentCall = call;

    // Show Disconnect button and hide Connect button
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-flex';

    // Event: Remote media stream received
    call.on('stream', (remoteStream) => {
        console.log('Remote MediaStream received.');
        remoteVideo.srcObject = remoteStream;
        if (remoteVideoPlaceholder) {
            remoteVideoPlaceholder.style.opacity = '0';
            setTimeout(() => { remoteVideoPlaceholder.style.display = 'none'; }, 400);
        }
        updateStatus('Connected', 'connected');
        showToast('Call connected!', 'success');

        // Re-apply current quality bitrate parameters to newly established WebRTC senders
        setMediaQuality(currentQuality);
    });

    // Event: Scenario - Remote user closes browser tab or terminates call
    call.on('close', () => {
        console.log('Call close event received.');
        showToast('Remote user disconnected', 'warning');
        resetCallUI('Remote user disconnected');
    });

    // Event: Call error handling
    call.on('error', (err) => {
        console.error('Call error:', err);
        showToast(`Call error: ${err.message || err}`, 'error');
        resetCallUI('Call Error');
    });

    // Scenario: Network fluctuation or IP change -> ICE connection state monitoring
    if (call.peerConnection) {
        monitorIceConnectionState(call.peerConnection);
    }
}

/**
 * Monitors underlying RTCPeerConnection ICE state and triggers automatic reconnect on loss.
 */
function monitorIceConnectionState(peerConnection) {
    peerConnection.oniceconnectionstatechange = () => {
        const iceState = peerConnection.iceConnectionState;
        console.log(`ICE Connection State changed: ${iceState}`);

        if (iceState === 'disconnected' || iceState === 'failed') {
            updateStatus('Reconnecting...', 'warning');
            showToast('Network unstable. Reconnecting call...', 'warning');

            // Clear any existing reconnect timer
            if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);

            // Automatically attempt to reconnect after a 2-second timeout
            reconnectTimeoutId = setTimeout(() => {
                if (remotePeerId && (!currentCall || !currentCall.open)) {
                    console.log(`Attempting ICE auto-reconnect call to: ${remotePeerId}`);
                    initiateCall(remotePeerId);
                }
            }, 2000);
        } else if (iceState === 'connected' || iceState === 'completed') {
            if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
            updateStatus('Connected', 'connected');
        }
    };
}

/**
 * Terminates the active call and resets UI elements.
 */
function hangUpCall(statusText = 'Call Ended') {
    if (currentCall) {
        currentCall.close();
    }
    showToast('Call disconnected', 'info');
    resetCallUI(statusText);
}

/**
 * Resets video elements and controls to initial disconnected state.
 */
function resetCallUI(statusMessage) {
    currentCall = null;
    if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);

    // Clear remote video source
    remoteVideo.srcObject = null;
    if (remoteVideoPlaceholder) {
        remoteVideoPlaceholder.style.display = 'flex';
        setTimeout(() => { remoteVideoPlaceholder.style.opacity = '1'; }, 50);
    }

    // Reset button displays
    connectBtn.style.display = 'inline-flex';
    disconnectBtn.style.display = 'none';

    updateStatus(statusMessage || 'Awaiting Connection', statusMessage === 'Connected' ? 'connected' : 'warning');
}

// ==========================================
// Dynamic Quality & Bandwidth Manipulation (Mutex-Guarded)
// ==========================================

/**
 * Applies dynamic resolution and bitrate constraints during an active call without dropping connection.
 * Uses an asynchronous mutex chain (qualityChangeQueue) to prevent concurrent setParameters calls.
 * 
 * @param {string} qualityLevel - 'high' | 'medium' | 'low'
 */
function setMediaQuality(qualityLevel) {
    if (!QUALITY_PRESETS[qualityLevel]) return Promise.resolve();

    // Chain quality modifications onto global queue to prevent concurrent setParameters race conditions
    qualityChangeQueue = qualityChangeQueue.then(async () => {
        try {
            await executeQualityChange(qualityLevel);
        } catch (err) {
            console.error('Error executing quality change:', err);
        }
    });

    return qualityChangeQueue;
}

/**
 * Internal worker function performing hardware track constraint updates & RTCRtpSender bitrate changes.
 */
async function executeQualityChange(qualityLevel) {
    currentQuality = qualityLevel;
    const preset = QUALITY_PRESETS[qualityLevel];

    // 1. Visual update of Quality button active state
    btnQualityHigh.classList.remove('active');
    btnQualityMedium.classList.remove('active');
    btnQualityLow.classList.remove('active');

    if (qualityLevel === 'high') btnQualityHigh.classList.add('active');
    else if (qualityLevel === 'medium') btnQualityMedium.classList.add('active');
    else if (qualityLevel === 'low') btnQualityLow.classList.add('active');

    // 2. Apply resolution and frame rate constraints to local hardware camera track
    if (localStream && localStream.getVideoTracks().length > 0) {
        const videoTrack = localStream.getVideoTracks()[0];
        try {
            await videoTrack.applyConstraints({
                width: { ideal: preset.width },
                height: { ideal: preset.height },
                frameRate: { ideal: preset.frameRate }
            });
            console.log(`Local video track constraints applied: ${preset.width}x${preset.height} @ ${preset.frameRate}fps`);
        } catch (err) {
            console.warn('Could not apply exact video track hardware constraints:', err);
        }
    }

    // 3. Apply bandwidth limits by iterating through active RTCPeerConnection senders
    if (currentCall && currentCall.peerConnection) {
        const senders = currentCall.peerConnection.getSenders();
        
        for (const sender of senders) {
            if (!sender.track) continue;

            // Video Sender Bandwidth Control
            if (sender.track.kind === 'video') {
                try {
                    const parameters = sender.getParameters();
                    if (!parameters.encodings || parameters.encodings.length === 0) {
                        parameters.encodings = [{}];
                    }
                    parameters.encodings[0].maxBitrate = preset.videoMaxBitrate;
                    
                    await sender.setParameters(parameters);
                    console.log(`Video RTCRtpSender maxBitrate updated to: ${preset.videoMaxBitrate} bps`);
                } catch (err) {
                    console.error('Error applying video RTCRtpSender parameters:', err);
                }
            }

            // Audio Sender Bandwidth Control
            if (sender.track.kind === 'audio') {
                try {
                    const parameters = sender.getParameters();
                    if (!parameters.encodings || parameters.encodings.length === 0) {
                        parameters.encodings = [{}];
                    }
                    parameters.encodings[0].maxBitrate = preset.audioMaxBitrate;

                    await sender.setParameters(parameters);
                    console.log(`Audio RTCRtpSender maxBitrate updated to: ${preset.audioMaxBitrate} bps`);
                } catch (err) {
                    console.error('Error applying audio RTCRtpSender parameters:', err);
                }
            }
        }
    }
}

// ==========================================
// Helper Utility & UI Toast Functions
// ==========================================

function updateStatus(message, state = 'warning') {
    if (connectionStatus) {
        connectionStatus.textContent = message;
    }
    if (statusBadge) {
        statusBadge.classList.remove('connected', 'disconnected');
        if (state === 'connected') statusBadge.classList.add('connected');
        if (state === 'disconnected') statusBadge.classList.add('disconnected');
    }
}

/**
 * Displays a sleek non-blocking toast notification in the UI.
 * @param {string} message 
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 */
function showToast(message, type = 'info') {
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3500);
}

/**
 * Copies text to clipboard with navigator.clipboard and execCommand fallback.
 */
function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Peer ID copied to clipboard!', 'success');
        }).catch(() => fallbackCopyText(text));
    } else {
        fallbackCopyText(text);
    }
}

function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        showToast('Peer ID copied to clipboard!', 'success');
    } catch (err) {
        showToast('Failed to copy Peer ID', 'error');
    }
    document.body.removeChild(textArea);
}
