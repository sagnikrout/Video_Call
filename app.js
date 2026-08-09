/**
 * Single-Page Peer-to-Peer WebRTC Video Calling Web Application
 * Built with HTML5, CSS3, Vanilla JavaScript, WebRTC, and PeerJS.
 */

// ==========================================
// Global Application State Variables
// ==========================================
let peer = null;                // PeerJS instance
let currentCall = null;         // Active PeerJS MediaConnection call object
let localStream = null;         // Local MediaStream (Camera & Microphone tracks)
let currentQuality = 'medium';  // Current quality level state ('high' | 'medium' | 'low')
let remotePeerId = '';          // Stores the remote peer ID for call management and reconnection
let reconnectTimeoutId = null;  // Timer reference for ICE auto-reconnection attempts

// Asynchronous mutex chain to queue quality modifications and prevent concurrent setParameters calls
let qualityChangeQueue = Promise.resolve();

// Exact Quality Preset Parameter Definitions
const QUALITY_PRESETS = {
    high: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        videoMaxBitrate: 4000000, // 4.0 Mbps (4,000,000 bits/sec)
        audioMaxBitrate: 128000   // 128 kbps (128,000 bits/sec)
    },
    medium: {
        width: 1280,
        height: 720,
        frameRate: 30,
        videoMaxBitrate: 1500000, // 1.5 Mbps (1,500,000 bits/sec)
        audioMaxBitrate: 64000    // 64 kbps (64,000 bits/sec)
    },
    low: {
        width: 854,
        height: 480,
        frameRate: 15,
        videoMaxBitrate: 500000,  // 500 kbps (500,000 bits/sec)
        audioMaxBitrate: 32000    // 32 kbps (32,000 bits/sec)
    }
};

// DOM Element References (exact IDs)
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const myIdDisplay = document.getElementById('my-id-display');
const copyIdBtn = document.getElementById('copy-id-btn');
const remoteIdInput = document.getElementById('remote-id-input');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleCamBtn = document.getElementById('toggle-cam-btn');
const connectionStatus = document.getElementById('connection-status');
const statusBadge = document.querySelector('.status-badge');
const remoteVideoPlaceholder = document.getElementById('remote-video-placeholder');

const btnQualityHigh = document.getElementById('btn-quality-high');
const btnQualityMedium = document.getElementById('btn-quality-medium');
const btnQualityLow = document.getElementById('btn-quality-low');

const toastContainer = document.getElementById('toast-container');

// ==========================================
// Initialization & Hardware Permission Logic
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initializeApplication();
});

/**
 * Main initialization workflow: setup event listeners, PeerJS signaling, and request media hardware.
 */
async function initializeApplication() {
    setupEventListeners();
    initializePeer();
    await requestMediaPermissions();
}

/**
 * Instantiates the PeerJS object and binds signaling connection events.
 */
function initializePeer() {
    updateStatus('Connecting to signaling server...', 'warning');
    
    // Instantiate new Peer object relying on the free PeerJS cloud server for signaling
    // Includes public STUN servers for NAT/firewall traversal
    peer = new Peer({
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });

    // Event 1: PeerJS signaling server assigns a unique Peer ID
    peer.on('open', (id) => {
        console.log('PeerJS connection open. Assigned Local Peer ID:', id);
        myIdDisplay.textContent = id;
        updateStatus('Awaiting Connection', 'warning');
        showToast('Registered with signaling server', 'success');
    });

    // Event 2: Scenario - Incoming call from a remote peer
    peer.on('call', (incomingCall) => {
        console.log('Incoming call received from:', incomingCall.peer);
        showToast(`Incoming call from: ${incomingCall.peer.substring(0, 8)}...`, 'info');
        handleIncomingCall(incomingCall);
    });

    // Event 3: Scenario - PeerJS signaling server disconnects
    peer.on('disconnected', () => {
        console.warn('Disconnected from PeerJS signaling server. Attempting auto-reconnection...');
        updateStatus('Reconnecting to server...', 'warning');
        showToast('Signaling server disconnected. Reconnecting...', 'warning');
        // Execute peer.reconnect() to re-establish connection to the signaling server
        peer.reconnect();
    });

    // Event 4: PeerJS Error Handling
    peer.on('error', (err) => {
        console.error('PeerJS signaling error:', err);
        if (err.type === 'peer-unavailable') {
            alert(`Peer ID "${remoteIdInput.value.trim()}" is not available or offline.`);
            updateStatus('Peer Unavailable', 'disconnected');
        } else {
            showToast(`Signaling Error: ${err.type}`, 'error');
            updateStatus(`Error: ${err.type}`, 'disconnected');
        }
    });
}

/**
 * Requests camera and microphone hardware access via navigator.mediaDevices.getUserMedia.
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
        console.log('User granted camera & microphone access. Local stream initialized.');

    } catch (error) {
        console.error('getUserMedia Error:', error);
        
        // Scenario: User denies permission (NotAllowedError)
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            alert('Camera and microphone permissions were denied. Please grant permissions in your browser settings to use video calling.');
            updateStatus('Permission Denied', 'disconnected');
        }
        // Scenario: Hardware missing (NotFoundError)
        else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            alert('No camera or microphone was detected on your device.');
            updateStatus('Hardware Not Found', 'disconnected');
        }
        else {
            alert(`Unable to access media hardware: ${error.message}`);
            updateStatus('Media Error', 'disconnected');
        }
    }
}

// ==========================================
// Media Track Toggle Logic (Microphone & Camera)
// ==========================================

/**
 * Binds UI event listeners for buttons and media controls.
 */
function setupEventListeners() {
    // Copy Peer ID button click handler
    copyIdBtn.addEventListener('click', () => {
        const idText = myIdDisplay.textContent;
        if (idText && idText !== 'Generating ID...') {
            copyToClipboard(idText);
        }
    });

    // Initiate call button click handler
    connectBtn.addEventListener('click', () => {
        const remoteId = remoteIdInput.value.trim();
        if (!remoteId) {
            alert('Please enter a valid destination Peer ID.');
            return;
        }
        if (peer && remoteId === peer.id) {
            alert('You cannot call your own Peer ID!');
            return;
        }
        initiateCall(remoteId);
    });

    // Disconnect button click handler
    disconnectBtn.addEventListener('click', () => {
        hangUpCall('Call Ended');
    });

    // Quality Selection Button Handlers
    btnQualityHigh.addEventListener('click', () => setMediaQuality('high'));
    btnQualityMedium.addEventListener('click', () => setMediaQuality('medium'));
    btnQualityLow.addEventListener('click', () => setMediaQuality('low'));

    // Microphone Toggle Button Handler
    if (toggleMicBtn) {
        toggleMicBtn.addEventListener('click', handleMicrophoneToggle);
    }

    // Camera Toggle Button Handler
    if (toggleCamBtn) {
        toggleCamBtn.addEventListener('click', handleCameraToggle);
    }
}

/**
 * Inline Explanation of MediaStreamTrack Toggling Logic (Microphone):
 * ------------------------------------------------------------------
 * 1. Calling localStream.getAudioTracks()[0] retrieves the active audio MediaStreamTrack.
 * 2. Inverting track.enabled (track.enabled = !track.enabled) immediately silences or resumes
 *    audio packet transmission over WebRTC without interrupting or renegotiating the connection.
 * 3. When track.enabled is false, zero-volume silence frames are transmitted.
 * 4. We toggle the 'inactive' CSS class on id="toggle-mic-btn" to provide clear visual feedback.
 */
function handleMicrophoneToggle() {
    if (!localStream || localStream.getAudioTracks().length === 0) {
        showToast('No active audio track available.', 'warning');
        return;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    
    // Invert the enabled property of the audio track
    audioTrack.enabled = !audioTrack.enabled;

    // Update button visual state: apply 'inactive' CSS class when disabled/muted
    if (!audioTrack.enabled) {
        toggleMicBtn.classList.add('inactive');
        toggleMicBtn.innerHTML = `
            <svg class="btn-icon mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="1" y1="1" x2="23" y2="23"></line>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            Mic Muted
        `;
        showToast('Microphone muted', 'info');
    } else {
        toggleMicBtn.classList.remove('inactive');
        toggleMicBtn.innerHTML = `
            <svg class="btn-icon mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            Mute Mic
        `;
        showToast('Microphone unmuted', 'info');
    }
}

/**
 * Inline Explanation of MediaStreamTrack Toggling Logic (Camera):
 * ----------------------------------------------------------------
 * 1. Calling localStream.getVideoTracks()[0] retrieves the active video MediaStreamTrack.
 * 2. Inverting track.enabled (track.enabled = !track.enabled) immediately pauses or resumes
 *    video frame transmission over WebRTC without tearing down the peer connection session.
 * 3. When track.enabled is false, black video frames are transmitted to the remote peer.
 * 4. We toggle the 'inactive' CSS class on id="toggle-cam-btn" to visually reflect the state.
 */
function handleCameraToggle() {
    if (!localStream || localStream.getVideoTracks().length === 0) {
        showToast('No active video track available.', 'warning');
        return;
    }

    const videoTrack = localStream.getVideoTracks()[0];
    
    // Invert the enabled property of the video track
    videoTrack.enabled = !videoTrack.enabled;

    // Update button visual state: apply 'inactive' CSS class when disabled/off
    if (!videoTrack.enabled) {
        toggleCamBtn.classList.add('inactive');
        toggleCamBtn.innerHTML = `
            <svg class="btn-icon cam-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
            Cam Off
        `;
        showToast('Camera video disabled', 'info');
    } else {
        toggleCamBtn.classList.remove('inactive');
        toggleCamBtn.innerHTML = `
            <svg class="btn-icon cam-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="23 7 16 12 23 17 23 7"></polygon>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
            Disable Cam
        `;
        showToast('Camera video enabled', 'info');
    }
}

// ==========================================
// Call Lifecycle Scenarios
// ==========================================

/**
 * 1. Outgoing call scenario: User enters an ID and clicks connect.
 * Executes peer.call(remoteId, localStream), stores call object, shows disconnect button, updates status to "Connecting...".
 */
function initiateCall(remoteId) {
    if (!localStream) {
        alert('Local stream is not ready. Please grant camera and microphone access.');
        return;
    }

    remotePeerId = remoteId;
    updateStatus('Connecting...', 'warning');

    console.log(`Initiating outgoing call to peer: ${remoteId}`);
    
    // Execute peer.call(remoteId, localStream)
    const call = peer.call(remoteId, localStream);
    
    // Store the resulting call object & setup handlers
    setupCallEvents(call);
}

/**
 * 2. Incoming call scenario: Listen for peer.on('call', call => {}).
 * Automatically answers using call.answer(localStream), stores call object, shows disconnect button, updates status to "Connected".
 */
function handleIncomingCall(call) {
    remotePeerId = call.peer;
    remoteIdInput.value = call.peer;

    // Automatically answer using call.answer(localStream)
    call.answer(localStream);
    
    // Store call object & setup handlers
    setupCallEvents(call);
}

/**
 * Sets up stream, close, error, and ICE state event listeners on the MediaConnection call object.
 */
function setupCallEvents(call) {
    currentCall = call;

    // Show disconnect button, hide connect button
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-flex';

    // 3. Receiving media scenario: Listen for call.on('stream', remoteStream => {})
    call.on('stream', (remoteStream) => {
        console.log('Remote MediaStream received.');
        
        // Assign remoteStream to the remote video element
        remoteVideo.srcObject = remoteStream;
        
        if (remoteVideoPlaceholder) {
            remoteVideoPlaceholder.style.opacity = '0';
            setTimeout(() => { remoteVideoPlaceholder.style.display = 'none'; }, 400);
        }

        // Update status to "Connected"
        updateStatus('Connected', 'connected');

        // Re-apply bandwidth limits to newly established senders
        setMediaQuality(currentQuality);
    });

    // 4. Remote user close tab scenario: Listen for call.on('close', () => {})
    call.on('close', () => {
        console.log('Call closed by remote user.');
        // Reset UI to initial state, clear remote video element, update status to "Remote user disconnected"
        resetCallUI('Remote user disconnected');
    });

    // Call error scenario
    call.on('error', (err) => {
        console.error('Call error:', err);
        resetCallUI('Call Error');
    });

    // Monitor underlying WebRTC connection ICE connection state
    if (call.peerConnection) {
        monitorIceConnectionState(call.peerConnection);
    }
}

/**
 * Network Stability Scenario: Monitors call.peerConnection.oniceconnectionstatechange.
 * If ICE state transitions to 'disconnected' or 'failed', automatically attempts to reconnect
 * by initiating a new call to the known remote ID after a 2-second timeout, updating status to "Reconnecting...".
 */
function monitorIceConnectionState(peerConnection) {
    peerConnection.oniceconnectionstatechange = () => {
        const iceState = peerConnection.iceConnectionState;
        console.log(`WebRTC ICE Connection State: ${iceState}`);

        if (iceState === 'disconnected' || iceState === 'failed') {
            // Update status text to "Reconnecting..."
            updateStatus('Reconnecting...', 'warning');

            if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);

            // Automatically attempt to reconnect after a 2-second timeout
            reconnectTimeoutId = setTimeout(() => {
                if (remotePeerId && (!currentCall || !currentCall.open)) {
                    console.log(`Initiating auto-reconnect call to remote ID: ${remotePeerId}`);
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
 * 4. Call termination scenario: When user clicks disconnect, execute call.close().
 * Clear remote video source, hide disconnect button, update status to "Call Ended".
 */
function hangUpCall(statusText = 'Call Ended') {
    if (currentCall) {
        currentCall.close();
    }
    resetCallUI(statusText);
}

/**
 * Resets the UI elements to initial state.
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

    // Hide disconnect button, show connect button
    connectBtn.style.display = 'inline-flex';
    disconnectBtn.style.display = 'none';

    updateStatus(statusMessage || 'Awaiting Connection', statusMessage === 'Connected' ? 'connected' : 'warning');
}

// ==========================================
// Quality Constraints & Bandwidth Manipulation
// ==========================================

/**
 * Applies dynamic constraints and bandwidth limits during an active call without dropping the connection.
 * Mutex-queued via qualityChangeQueue to prevent concurrent setParameters race conditions.
 * 
 * Extensive Inline Comments Explaining RTCRtpSender Parameter Manipulation:
 * -------------------------------------------------------------------------
 * 1. The WebRTC RTCPeerConnection object manages media transmission through individual RTCRtpSender instances.
 *    Each RTCRtpSender is responsible for encoding and transmitting a single MediaStreamTrack (audio or video).
 * 2. Calling sender.getParameters() fetches an RTCRtpSendParameters object representing the current encoding configuration.
 * 3. The `parameters.encodings` array contains RTCRtpEncodingParameters objects for each RTP stream layer.
 * 4. Modifying `parameters.encodings[0].maxBitrate` sets the maximum allowable bandwidth cap (in bits per second)
 *    enforced dynamically by the browser's WebRTC rate controller and BWE (Bandwidth Estimation) engine.
 * 5. Invoking sender.setParameters(parameters) applies these bitrate limits directly to the live SRTP/DTLS stream.
 *    This allows changing video quality dynamically (e.g. 4.0 Mbps -> 1.5 Mbps -> 500 kbps) instantly without dropping
 *    the active peer call or triggering SDP renegotiation.
 * 
 * @param {string} qualityLevel - 'high' | 'medium' | 'low'
 */
function setMediaQuality(qualityLevel) {
    if (!QUALITY_PRESETS[qualityLevel]) return Promise.resolve();

    // Queue quality execution to guarantee non-concurrent setParameters calls
    qualityChangeQueue = qualityChangeQueue.then(async () => {
        try {
            await executeQualityChange(qualityLevel);
        } catch (err) {
            console.error('Error applying setMediaQuality:', err);
        }
    });

    return qualityChangeQueue;
}

/**
 * Core implementation function for hardware constraints & RTCRtpSender bitrate caps.
 */
async function executeQualityChange(qualityLevel) {
    currentQuality = qualityLevel;
    const preset = QUALITY_PRESETS[qualityLevel];

    // 1. Change the visual active state of quality buttons
    btnQualityHigh.classList.remove('active');
    btnQualityMedium.classList.remove('active');
    btnQualityLow.classList.remove('active');

    if (qualityLevel === 'high') btnQualityHigh.classList.add('active');
    else if (qualityLevel === 'medium') btnQualityMedium.classList.add('active');
    else if (qualityLevel === 'low') btnQualityLow.classList.add('active');

    // 2. Apply resolution and frame rate changes to local hardware using localStream.getVideoTracks()[0].applyConstraints()
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
            console.warn('Could not apply video track hardware constraints:', err);
        }
    }

    // 3. Apply bandwidth limits by iterating through the active Call object's peerConnection.getSenders()
    if (currentCall && currentCall.peerConnection) {
        const senders = currentCall.peerConnection.getSenders();
        
        for (const sender of senders) {
            if (!sender.track) continue;

            // 4. For video sender: call getParameters(), modify parameters.encodings[0].maxBitrate, apply with setParameters(parameters)
            if (sender.track.kind === 'video') {
                try {
                    const parameters = sender.getParameters();
                    if (!parameters.encodings || parameters.encodings.length === 0) {
                        parameters.encodings = [{}];
                    }
                    parameters.encodings[0].maxBitrate = preset.videoMaxBitrate;
                    
                    await sender.setParameters(parameters);
                    console.log(`Video RTCRtpSender maxBitrate updated: ${preset.videoMaxBitrate} bps`);
                } catch (err) {
                    console.error('Error in video RTCRtpSender setParameters:', err);
                }
            }

            // For audio sender: modify parameters.encodings[0].maxBitrate, apply with setParameters(parameters)
            if (sender.track.kind === 'audio') {
                try {
                    const parameters = sender.getParameters();
                    if (!parameters.encodings || parameters.encodings.length === 0) {
                        parameters.encodings = [{}];
                    }
                    parameters.encodings[0].maxBitrate = preset.audioMaxBitrate;

                    await sender.setParameters(parameters);
                    console.log(`Audio RTCRtpSender maxBitrate updated: ${preset.audioMaxBitrate} bps`);
                } catch (err) {
                    console.error('Error in audio RTCRtpSender setParameters:', err);
                }
            }
        }
    }
}

// ==========================================
// Helper Utility Functions
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

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Peer ID copied to clipboard!', 'success');
        }).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
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
