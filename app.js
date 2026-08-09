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

const micSelect = document.getElementById('mic-select');
const cameraSelect = document.getElementById('camera-select');
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
    
    // Instantiate new Peer object relying on free PeerJS cloud server
    // Includes public STUN servers for NAT/firewall traversal
    peer = new Peer({
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });

    peer.on('open', (id) => {
        console.log('PeerJS connection open. Assigned Local Peer ID:', id);
        myIdDisplay.textContent = id;
        updateStatus('Awaiting Connection', 'warning');
        showToast('Registered with signaling server', 'success');
    });

    peer.on('call', (incomingCall) => {
        console.log('Incoming call received from:', incomingCall.peer);
        showToast(`Incoming call from: ${incomingCall.peer.substring(0, 8)}...`, 'info');
        handleIncomingCall(incomingCall);
    });

    peer.on('disconnected', () => {
        console.warn('Disconnected from PeerJS signaling server. Attempting auto-reconnection...');
        updateStatus('Reconnecting to server...', 'warning');
        showToast('Signaling server disconnected. Reconnecting...', 'warning');
        peer.reconnect();
    });

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

        // User granted permission
        localStream = stream;
        localVideo.srcObject = stream;
        
        // Populate device selection dropdowns (Zoom / Meet style)
        await populateDeviceLists();
        
        // Listen for hardware device hot-plugging (headsets / webcams plugged or unplugged)
        if (navigator.mediaDevices.ondevicechange !== undefined) {
            navigator.mediaDevices.ondevicechange = () => populateDeviceLists();
        }

        // Default the quality state to "Medium"
        await setMediaQuality('medium');
        console.log('User granted camera & microphone access. Local stream initialized.');

    } catch (error) {
        console.error('getUserMedia Error:', error);
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            alert('Camera and microphone permissions were denied. Please grant permissions in your browser settings to use video calling.');
            updateStatus('Permission Denied', 'disconnected');
        }
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
// Device Selection & Hardware Enumeration (Zoom/Meet Style)
// ==========================================

/**
 * Enumerates connected media devices and populates microphone and camera selection dropdowns.
 */
async function populateDeviceLists() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const audioDevices = devices.filter(d => d.kind === 'audioinput');
        const videoDevices = devices.filter(d => d.kind === 'videoinput');

        // Populate Microphone Select Dropdown
        if (micSelect) {
            micSelect.innerHTML = '';
            audioDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microphone ${index + 1}`;
                micSelect.appendChild(option);
            });

            // Set current active track device as selected option
            if (localStream && localStream.getAudioTracks().length > 0) {
                const currentAudioDeviceId = localStream.getAudioTracks()[0].getSettings().deviceId;
                if (currentAudioDeviceId) micSelect.value = currentAudioDeviceId;
            }
        }

        // Populate Camera Select Dropdown
        if (cameraSelect) {
            cameraSelect.innerHTML = '';
            videoDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Camera ${index + 1}`;
                cameraSelect.appendChild(option);
            });

            // Set current active track device as selected option
            if (localStream && localStream.getVideoTracks().length > 0) {
                const currentVideoDeviceId = localStream.getVideoTracks()[0].getSettings().deviceId;
                if (currentVideoDeviceId) cameraSelect.value = currentVideoDeviceId;
            }
        }

        console.log(`Devices enumerated: ${audioDevices.length} Mics, ${videoDevices.length} Cameras.`);
    } catch (err) {
        console.error('Error enumerating media devices:', err);
    }
}

/**
 * Live switches the active camera device mid-call without dropping WebRTC connection.
 */
async function switchCamera(deviceId) {
    if (!deviceId || !localStream) return;

    const preset = QUALITY_PRESETS[currentQuality] || QUALITY_PRESETS.medium;
    console.log(`Switching camera to deviceId: ${deviceId}`);

    try {
        // Request new video stream from target camera device
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: { exact: deviceId },
                width: { ideal: preset.width },
                height: { ideal: preset.height },
                frameRate: { ideal: preset.frameRate }
            }
        });

        const newVideoTrack = newStream.getVideoTracks()[0];
        const oldVideoTrack = localStream.getVideoTracks()[0];

        // Stop previous video track hardware
        if (oldVideoTrack) {
            oldVideoTrack.stop();
            localStream.removeTrack(oldVideoTrack);
        }

        // Add new track to local stream and update video element
        localStream.addTrack(newVideoTrack);
        localVideo.srcObject = localStream;

        // Replace track on active WebRTC peer connection senders
        if (currentCall && currentCall.peerConnection) {
            const senders = currentCall.peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(newVideoTrack);
                console.log('RTCRtpSender replaceTrack succeeded for camera switch.');
            }
        }

        showToast('Camera switched successfully', 'success');
    } catch (err) {
        console.error('Failed to switch camera:', err);
        showToast('Failed to switch camera device', 'error');
    }
}

/**
 * Live switches the active microphone device mid-call without dropping WebRTC connection.
 */
async function switchMicrophone(deviceId) {
    if (!deviceId || !localStream) return;

    console.log(`Switching microphone to deviceId: ${deviceId}`);

    try {
        // Request new audio stream from target microphone device
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: deviceId } }
        });

        const newAudioTrack = newStream.getAudioTracks()[0];
        const oldAudioTrack = localStream.getAudioTracks()[0];

        // Stop previous audio track hardware
        if (oldAudioTrack) {
            oldAudioTrack.stop();
            localStream.removeTrack(oldAudioTrack);
        }

        // Add new audio track to local stream
        localStream.addTrack(newAudioTrack);

        // Replace track on active WebRTC peer connection senders
        if (currentCall && currentCall.peerConnection) {
            const senders = currentCall.peerConnection.getSenders();
            const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
            if (audioSender) {
                await audioSender.replaceTrack(newAudioTrack);
                console.log('RTCRtpSender replaceTrack succeeded for microphone switch.');
            }
        }

        showToast('Microphone switched successfully', 'success');
    } catch (err) {
        console.error('Failed to switch microphone:', err);
        showToast('Failed to switch microphone device', 'error');
    }
}

// ==========================================
// Media Track Toggle Logic (Microphone & Camera)
// ==========================================

function setupEventListeners() {
    copyIdBtn.addEventListener('click', () => {
        const idText = myIdDisplay.textContent;
        if (idText && idText !== 'Generating ID...') {
            copyToClipboard(idText);
        }
    });

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

    disconnectBtn.addEventListener('click', () => {
        hangUpCall('Call Ended');
    });

    btnQualityHigh.addEventListener('click', () => setMediaQuality('high'));
    btnQualityMedium.addEventListener('click', () => setMediaQuality('medium'));
    btnQualityLow.addEventListener('click', () => setMediaQuality('low'));

    if (toggleMicBtn) {
        toggleMicBtn.addEventListener('click', handleMicrophoneToggle);
    }

    if (toggleCamBtn) {
        toggleCamBtn.addEventListener('click', handleCameraToggle);
    }

    // Hardware Device Dropdown Change Handlers
    if (micSelect) {
        micSelect.addEventListener('change', (e) => switchMicrophone(e.target.value));
    }
    if (cameraSelect) {
        cameraSelect.addEventListener('change', (e) => switchCamera(e.target.value));
    }
}

function handleMicrophoneToggle() {
    if (!localStream || localStream.getAudioTracks().length === 0) {
        showToast('No active audio track available.', 'warning');
        return;
    }

    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;

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

function handleCameraToggle() {
    if (!localStream || localStream.getVideoTracks().length === 0) {
        showToast('No active video track available.', 'warning');
        return;
    }

    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;

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

function initiateCall(remoteId) {
    if (!localStream) {
        alert('Local stream is not ready. Please grant camera and microphone access.');
        return;
    }

    remotePeerId = remoteId;
    updateStatus('Connecting...', 'warning');

    console.log(`Initiating outgoing call to peer: ${remoteId}`);
    const call = peer.call(remoteId, localStream);
    setupCallEvents(call);
}

function handleIncomingCall(call) {
    remotePeerId = call.peer;
    remoteIdInput.value = call.peer;
    call.answer(localStream);
    setupCallEvents(call);
}

function setupCallEvents(call) {
    currentCall = call;

    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-flex';

    call.on('stream', (remoteStream) => {
        console.log('Remote MediaStream received.');
        remoteVideo.srcObject = remoteStream;
        
        if (remoteVideoPlaceholder) {
            remoteVideoPlaceholder.style.opacity = '0';
            setTimeout(() => { remoteVideoPlaceholder.style.display = 'none'; }, 400);
        }

        updateStatus('Connected', 'connected');
        setMediaQuality(currentQuality);
    });

    call.on('close', () => {
        console.log('Call closed by remote user.');
        resetCallUI('Remote user disconnected');
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        resetCallUI('Call Error');
    });

    if (call.peerConnection) {
        monitorIceConnectionState(call.peerConnection);
    }
}

function monitorIceConnectionState(peerConnection) {
    peerConnection.oniceconnectionstatechange = () => {
        const iceState = peerConnection.iceConnectionState;
        console.log(`WebRTC ICE Connection State: ${iceState}`);

        if (iceState === 'disconnected' || iceState === 'failed') {
            updateStatus('Reconnecting...', 'warning');

            if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);

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

function hangUpCall(statusText = 'Call Ended') {
    if (currentCall) {
        currentCall.close();
    }
    resetCallUI(statusText);
}

function resetCallUI(statusMessage) {
    currentCall = null;
    if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);

    remoteVideo.srcObject = null;
    if (remoteVideoPlaceholder) {
        remoteVideoPlaceholder.style.display = 'flex';
        setTimeout(() => { remoteVideoPlaceholder.style.opacity = '1'; }, 50);
    }

    connectBtn.style.display = 'inline-flex';
    disconnectBtn.style.display = 'none';

    updateStatus(statusMessage || 'Awaiting Connection', statusMessage === 'Connected' ? 'connected' : 'warning');
}

// ==========================================
// Quality Constraints & Bandwidth Manipulation
// ==========================================

function setMediaQuality(qualityLevel) {
    if (!QUALITY_PRESETS[qualityLevel]) return Promise.resolve();

    qualityChangeQueue = qualityChangeQueue.then(async () => {
        try {
            await executeQualityChange(qualityLevel);
        } catch (err) {
            console.error('Error applying setMediaQuality:', err);
        }
    });

    return qualityChangeQueue;
}

async function executeQualityChange(qualityLevel) {
    currentQuality = qualityLevel;
    const preset = QUALITY_PRESETS[qualityLevel];

    btnQualityHigh.classList.remove('active');
    btnQualityMedium.classList.remove('active');
    btnQualityLow.classList.remove('active');

    if (qualityLevel === 'high') btnQualityHigh.classList.add('active');
    else if (qualityLevel === 'medium') btnQualityMedium.classList.add('active');
    else if (qualityLevel === 'low') btnQualityLow.classList.add('active');

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

    if (currentCall && currentCall.peerConnection) {
        const senders = currentCall.peerConnection.getSenders();
        
        for (const sender of senders) {
            if (!sender.track) continue;

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

// ==========================================
// Clean Page Reload & Unload Resource Cleanup
// ==========================================
window.addEventListener('beforeunload', cleanupResources);
window.addEventListener('pagehide', cleanupResources);

function cleanupResources() {
    if (localStream) {
        localStream.getTracks().forEach(track => {
            try { track.stop(); } catch (e) {}
        });
    }
    if (currentCall) {
        try { currentCall.close(); } catch (e) {}
    }
    if (peer) {
        try { peer.destroy(); } catch (e) {}
    }
}
