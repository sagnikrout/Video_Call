/**
 * Peer-to-Peer WebRTC Video Calling Application
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
 * Instantiates the PeerJS object and attaches signaling lifecycle handlers.
 */
function initializePeer() {
    updateStatus('Connecting to signaling server...', 'warning');
    
    // Connect to PeerJS cloud signaling server
    peer = new Peer();

    // Event 1: Assigned a unique Peer ID by the signaling server
    peer.on('open', (id) => {
        console.log('PeerJS server connection established. Local ID:', id);
        myIdDisplay.textContent = id;
        updateStatus('Awaiting Connection', 'warning');
    });

    // Event 2: Listen for incoming calls from remote peers
    peer.on('call', (incomingCall) => {
        console.log('Incoming call received from:', incomingCall.peer);
        handleIncomingCall(incomingCall);
    });

    // Event 3: Scenario - PeerJS signaling server disconnects
    peer.on('disconnected', () => {
        console.warn('Disconnected from PeerJS signaling server. Attempting reconnection...');
        updateStatus('Reconnecting to server...', 'warning');
        // Re-establish connection to the signaling server
        peer.reconnect();
    });

    // Event 4: PeerJS Error Handling
    peer.on('error', (err) => {
        console.error('PeerJS error encountered:', err);
        if (err.type === 'peer-unavailable') {
            alert(`Peer ID "${remoteIdInput.value.trim()}" is not available or offline.`);
            updateStatus('Peer Unavailable', 'disconnected');
        } else {
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
            alert('Camera and microphone permissions were denied. Please grant permissions in your browser address bar to use video calling.');
            updateStatus('Permission Denied', 'disconnected');
        }
        // Scenario: Hardware missing (NotFoundError)
        else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            alert('No camera or microphone was detected on your device.');
            updateStatus('Hardware Not Found', 'disconnected');
        }
        else {
            alert(`Unable to access camera/microphone: ${error.message}`);
            updateStatus('Media Error', 'disconnected');
        }
    }
}

// ==========================================
// Event Listeners & Control Handlers
// ==========================================
function setupEventListeners() {
    // Copy Peer ID to clipboard
    copyIdBtn.addEventListener('click', () => {
        const idText = myIdDisplay.textContent;
        if (idText && idText !== 'Generating ID...') {
            navigator.clipboard.writeText(idText).then(() => {
                const originalText = copyIdBtn.innerHTML;
                copyIdBtn.innerHTML = 'Copied!';
                setTimeout(() => { copyIdBtn.innerHTML = originalText; }, 1800);
            }).catch(err => console.error('Failed to copy ID:', err));
        }
    });

    // Initiate call on button click
    connectBtn.addEventListener('click', () => {
        const remoteId = remoteIdInput.value.trim();
        if (!remoteId) {
            alert('Please enter a valid remote Peer ID to call.');
            return;
        }
        if (peer && remoteId === peer.id) {
            alert('You cannot call your own Peer ID!');
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
}

// ==========================================
// Call Lifecycle Management
// ==========================================

/**
 * Outgoing call scenario: Calls the remote peer and hooks into stream/event listeners.
 */
function initiateCall(remoteId) {
    if (!localStream) {
        alert('Local media stream is not ready. Please enable camera and microphone access.');
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
    if (!localStream) {
        console.warn('Answering call without local stream.');
    }

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

        // Re-apply current quality bitrate parameters to newly established WebRTC senders
        setMediaQuality(currentQuality);
    });

    // Event: Scenario - Remote user closes browser tab or terminates call
    call.on('close', () => {
        console.log('Call close event received.');
        resetCallUI('Remote user disconnected');
    });

    // Event: Call error handling
    call.on('error', (err) => {
        console.error('Call error:', err);
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
// Dynamic Quality & Bandwidth Manipulation
// ==========================================

/**
 * Applies dynamic resolution and bitrate constraints during an active call without dropping connection.
 * 
 * Extensive Inline Explanation of RTCRtpSender Parameter Manipulation:
 * ------------------------------------------------------------------
 * 1. An RTCRtpSender inspects and controls the encoding and transmission of a single media track
 *    (video or audio) attached to an RTCPeerConnection.
 * 2. Calling sender.getParameters() fetches an RTCRtpSendParameters object which includes `encodings`.
 * 3. The `encodings` array contains RTCRtpEncodingParameters objects representing individual stream
 *    layers (e.g. maxBitrate, maxFramerate, scaleResolutionDownBy).
 * 4. Modifying `encodings[0].maxBitrate` sets the maximum allowable bandwidth cap (in bits per second)
 *    enforced dynamically by the browser's WebRTC congestion controller and rate control engine.
 * 5. Calling sender.setParameters(parameters) applies these new bitrate limitations immediately to the
 *    active SRTP/DTLS stream without needing to renegotiate the SDP offer/answer session or renegotiate ICE.
 * 
 * @param {string} qualityLevel - 'high' | 'medium' | 'low'
 */
async function setMediaQuality(qualityLevel) {
    if (!QUALITY_PRESETS[qualityLevel]) return;
    
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
                    // Fetch current RTCRtpSendParameters
                    const parameters = sender.getParameters();
                    if (!parameters.encodings || parameters.encodings.length === 0) {
                        parameters.encodings = [{}];
                    }
                    // Assign new maxBitrate parameter in bits per second
                    parameters.encodings[0].maxBitrate = preset.videoMaxBitrate;
                    
                    // Commit encodings parameters to live RTCRtpSender
                    await sender.setParameters(parameters);
                    console.log(`Video RTCRtpSender maxBitrate updated to: ${preset.videoMaxBitrate} bps`);
                } catch (err) {
                    console.error('Error applying video RTCRtpSender parameters:', err);
                }
            }

            // Audio Sender Bandwidth Control
            if (sender.track.kind === 'audio') {
                try {
                    // Fetch current RTCRtpSendParameters
                    const parameters = sender.getParameters();
                    if (!parameters.encodings || parameters.encodings.length === 0) {
                        parameters.encodings = [{}];
                    }
                    // Assign new maxBitrate parameter in bits per second
                    parameters.encodings[0].maxBitrate = preset.audioMaxBitrate;

                    // Commit encodings parameters to live RTCRtpSender
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
