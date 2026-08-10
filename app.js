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

// In-Call UX & Screen Sharing state
let callStartTime = null;       // Timestamp when active call started
let callTimerInterval = null;   // Interval handle for live call duration counter
let isScreenSharing = false;    // Whether user is currently sharing screen
let screenStream = null;        // Active MediaStream for screen capture

// Asynchronous mutex chain to queue quality modifications and prevent concurrent setParameters calls
let qualityChangeQueue = Promise.resolve();

const QUALITY_PRESETS = {
    high: {
        width: 2560,
        height: 1440,
        frameRate: 60,
        videoMaxBitrate: 8000000, // 8.0 Mbps
        audioMaxBitrate: 256000   // 256 kbps
    },
    medium: {
        width: 1920,
        height: 1080,
        frameRate: 60,
        videoMaxBitrate: 4000000, // 4.0 Mbps
        audioMaxBitrate: 128000   // 128 kbps
    },
    low: {
        width: 1280,
        height: 720,
        frameRate: 30,
        videoMaxBitrate: 1500000, // 1.5 Mbps
        audioMaxBitrate: 64000    // 64 kbps
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

const infoBtn = document.getElementById('info-btn');
const infoPanel = document.getElementById('info-panel');
const closeInfoBtn = document.getElementById('close-info-btn');
const statUpload = document.getElementById('stat-upload');
const statDownload = document.getElementById('stat-download');

// ==========================================
// Telemetry Globals
// ==========================================
let telemetryIntervalId = null;
let lastBytesSent = 0;
let lastBytesReceived = 0;
let lastTimestamp = 0;

// ==========================================
// Initialization & Hardware Permission Logic
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initializeApplication();
});

/**
 * Main initialization workflow: setup event listeners, PeerJS signaling, drag engine, and request media hardware.
 */
async function initializeApplication() {
    setupEventListeners();
    initializePeer();
    
    const localVideoTile = document.getElementById('local-video-tile');
    if (localVideoTile) makeElementDraggable(localVideoTile);

    await requestMediaPermissions();
}

/**
 * Enables smooth drag and corner snapping behavior on target floating PIP tile.
 * 
 * @param {HTMLElement} el - The floating PIP video container element.
 */
function makeElementDraggable(el) {
    if (!el) return;

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    el.addEventListener('mousedown', dragStart);
    el.addEventListener('touchstart', dragStart, { passive: false });

    function dragStart(e) {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;

        isDragging = true;
        el.classList.add('dragging');

        const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;

        startX = clientX;
        startY = clientY;

        const rect = el.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        document.addEventListener('mousemove', dragMove);
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);
    }

    function dragMove(e) {
        if (!isDragging) return;
        
        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        // Viewport Boundary Clamping
        const padding = 16;
        const maxLeft = window.innerWidth - el.offsetWidth - padding;
        const maxTop = window.innerHeight - el.offsetHeight - padding;

        newLeft = Math.max(padding, Math.min(newLeft, maxLeft));
        newTop = Math.max(padding, Math.min(newTop, maxTop));

        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';

        if (e.cancelable) e.preventDefault();
    }

    function dragEnd() {
        if (!isDragging) return;
        isDragging = false;
        el.classList.remove('dragging');

        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('touchmove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('touchend', dragEnd);
    }

    // Double-click to cycle corners: Top-Right -> Top-Left -> Bottom-Left -> Bottom-Right
    let currentCornerIndex = 0;
    const corners = [
        { name: 'Top-Left', getPos: (w, h) => ({ left: 24, top: 24 }) },
        { name: 'Bottom-Left', getPos: (w, h) => ({ left: 24, top: window.innerHeight - h - 24 }) },
        { name: 'Bottom-Right', getPos: (w, h) => ({ left: window.innerWidth - w - 24, top: window.innerHeight - h - 24 }) },
        { name: 'Top-Right', getPos: (w, h) => ({ left: window.innerWidth - w - 24, top: 24 }) }
    ];

    el.addEventListener('dblclick', () => {
        currentCornerIndex = (currentCornerIndex + 1) % corners.length;
        const pos = corners[currentCornerIndex].getPos(el.offsetWidth, el.offsetHeight);
        
        el.style.transition = 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.left = `${pos.left}px`;
        el.style.top = `${pos.top}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';

        setTimeout(() => {
            el.style.transition = 'box-shadow 0.25s ease, border-color 0.25s ease, transform 0.2s ease';
        }, 350);
        showToast(`Moved preview to ${corners[currentCornerIndex].name}`, 'info');
    });
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
            showToast('Could not connect to peer', 'error');
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
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const videoConstraints = isMobileDevice 
            ? {
                frameRate: { ideal: QUALITY_PRESETS.medium.frameRate },
                facingMode: { ideal: 'user' }
              }
            : {
                width: { ideal: QUALITY_PRESETS.medium.width },
                height: { ideal: QUALITY_PRESETS.medium.height },
                aspectRatio: { ideal: 1.7777777778 },
                frameRate: { ideal: QUALITY_PRESETS.medium.frameRate }
              };

        const stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: { ideal: 2 },
                sampleRate: { ideal: 48000 }
            }
        });

        // User granted permission
        localStream = stream;
        localVideo.srcObject = stream;
        
        // Hide fallback avatar placeholder so live video feed is displayed
        const localCamAvatar = document.getElementById('local-cam-off-avatar');
        if (localCamAvatar) localCamAvatar.classList.add('hidden');

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
 * Toggles a target dock popover and closes all other open popovers.
 * 
 * @param {HTMLElement} targetPopover - The popover element to toggle.
 */
function togglePopover(targetPopover) {
    const allPopovers = document.querySelectorAll('.dock-popover');
    allPopovers.forEach(popover => {
        if (popover !== targetPopover) {
            popover.classList.add('hidden');
        }
    });
    if (targetPopover) {
        targetPopover.classList.toggle('hidden');
    }
}

/**
 * Closes all open dock popovers.
 */
function closeAllPopovers() {
    const allPopovers = document.querySelectorAll('.dock-popover');
    allPopovers.forEach(popover => popover.classList.add('hidden'));
}

// ==========================================
// Device Selection & Hardware Enumeration (Zoom/Meet Style)
// ==========================================

/**
 * Enumerates connected media devices and populates microphone and camera selection dropdowns & popovers.
 */
async function populateDeviceLists() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const audioDevices = devices.filter(d => d.kind === 'audioinput');
        const videoDevices = devices.filter(d => d.kind === 'videoinput');

        let currentAudioDeviceId = localStream && localStream.getAudioTracks().length > 0 ? 
            localStream.getAudioTracks()[0].getSettings().deviceId : null;
        let currentVideoDeviceId = localStream && localStream.getVideoTracks().length > 0 ? 
            localStream.getVideoTracks()[0].getSettings().deviceId : null;

        // Populate Microphone Select Dropdown & Popover List
        if (micSelect) {
            micSelect.innerHTML = '';
            audioDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microphone ${index + 1}`;
                micSelect.appendChild(option);
            });

            if (currentAudioDeviceId) micSelect.value = currentAudioDeviceId;
        }

        const micDeviceList = document.getElementById('mic-device-list');
        if (micDeviceList) {
            micDeviceList.innerHTML = '';
            audioDevices.forEach((device, index) => {
                const item = document.createElement('div');
                const isCurrent = currentAudioDeviceId === device.deviceId;
                item.className = `device-item ${isCurrent ? 'active' : ''}`;
                item.innerHTML = `<span>${device.label || `Microphone ${index + 1}`}</span> ${isCurrent ? '<span>✓</span>' : ''}`;
                item.addEventListener('click', () => {
                    switchMicrophone(device.deviceId);
                    if (micSelect) micSelect.value = device.deviceId;
                    closeAllPopovers();
                });
                micDeviceList.appendChild(item);
            });
        }

        // Populate Camera Select Dropdown & Popover List
        if (cameraSelect) {
            cameraSelect.innerHTML = '';
            videoDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Camera ${index + 1}`;
                cameraSelect.appendChild(option);
            });

            if (currentVideoDeviceId) cameraSelect.value = currentVideoDeviceId;
        }

        const cameraDeviceList = document.getElementById('camera-device-list');
        if (cameraDeviceList) {
            cameraDeviceList.innerHTML = '';
            videoDevices.forEach((device, index) => {
                const item = document.createElement('div');
                const isCurrent = currentVideoDeviceId === device.deviceId;
                item.className = `device-item ${isCurrent ? 'active' : ''}`;
                item.innerHTML = `<span>${device.label || `Camera ${index + 1}`}</span> ${isCurrent ? '<span>✓</span>' : ''}`;
                item.addEventListener('click', () => {
                    switchCamera(device.deviceId);
                    if (cameraSelect) cameraSelect.value = device.deviceId;
                    closeAllPopovers();
                });
                cameraDeviceList.appendChild(item);
            });
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

        populateDeviceLists();
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

        populateDeviceLists();
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
    const micPopover = document.getElementById('mic-popover');
    const cameraPopover = document.getElementById('camera-popover');
    const settingsPopover = document.getElementById('settings-popover');

    const micArrowBtn = document.getElementById('mic-arrow-btn');
    const camArrowBtn = document.getElementById('cam-arrow-btn');
    const settingsBtn = document.getElementById('settings-btn');

    if (infoBtn && infoPanel && closeInfoBtn) {
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            infoPanel.classList.remove('hidden');
            const allPopovers = document.querySelectorAll('.dock-popover');
            allPopovers.forEach(pop => { if (pop !== infoPanel) pop.classList.add('hidden'); });
        });
        closeInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            infoPanel.classList.add('hidden');
        });
    }

    if (micArrowBtn && micPopover) {
        micArrowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover(micPopover);
        });
    }

    if (camArrowBtn && cameraPopover) {
        camArrowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover(cameraPopover);
        });
    }

    if (settingsBtn && settingsPopover) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover(settingsPopover);
        });
    }

    // Auto-close popovers when clicking anywhere outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dock-popover') && !e.target.closest('.floating-dock')) {
            closeAllPopovers();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllPopovers();
        }
    });

    const collapseInfoBtn = document.getElementById('collapse-info-btn');
    if (collapseInfoBtn && infoPanel) {
        collapseInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            infoPanel.classList.toggle('collapsed');
        });
    }

    const endCallDockBtn = document.getElementById('end-call-dock-btn');
    if (endCallDockBtn) {
        endCallDockBtn.addEventListener('click', () => {
            hangUpCall('Call Ended');
        });
    }

    const screenshareBtn = document.getElementById('screenshare-btn');
    if (screenshareBtn) {
        screenshareBtn.addEventListener('click', toggleScreenShare);
    }

    copyIdBtn.addEventListener('click', () => {
        const idText = myIdDisplay.textContent;
        if (idText && idText !== 'Generating ID...') {
            copyToClipboard(idText);
        }
    });

    connectBtn.addEventListener('click', () => {
        const remoteId = remoteIdInput.value.trim();
        if (!remoteId) {
            showToast('Please enter a valid Peer ID.', 'error');
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

    // Settings Popover Quality Buttons
    const popoverQualityHigh = document.getElementById('popover-quality-high');
    const popoverQualityMedium = document.getElementById('popover-quality-medium');
    const popoverQualityLow = document.getElementById('popover-quality-low');

    if (popoverQualityHigh) popoverQualityHigh.addEventListener('click', () => { setMediaQuality('high'); updatePopoverQualityButtons('high'); });
    if (popoverQualityMedium) popoverQualityMedium.addEventListener('click', () => { setMediaQuality('medium'); updatePopoverQualityButtons('medium'); });
    if (popoverQualityLow) popoverQualityLow.addEventListener('click', () => { setMediaQuality('low'); updatePopoverQualityButtons('low'); });

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
        showToast('Microphone Muted', 'warning');
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
    const localCamAvatar = document.getElementById('local-cam-off-avatar');

    if (!videoTrack.enabled) {
        if (localCamAvatar) localCamAvatar.classList.remove('hidden');
        toggleCamBtn.classList.add('inactive');
        toggleCamBtn.innerHTML = `
            <svg class="btn-icon cam-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
            Cam Off
        `;
        showToast('Camera Disabled', 'warning');
    } else {
        if (localCamAvatar) localCamAvatar.classList.add('hidden');
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
 * Initiates an outgoing WebRTC call to a specified remote peer.
 * Encapsulates the call logic in a try/catch block to prevent silent failures.
 * 
 * @param {string} remoteId - The PeerJS ID of the destination client.
 */
function initiateCall(remoteId) {
    if (!localStream) {
        showToast('Local stream is not ready. Please grant camera and microphone access.', 'error');
        return;
    }

    remotePeerId = remoteId;
    updateStatus('Connecting...', 'warning');
    console.log(`Initiating outgoing call to peer: ${remoteId}`);

    try {
        const call = peer.call(remoteId, localStream);
        if (!call) throw new Error("PeerJS failed to create the call object.");
        setupCallEvents(call);
    } catch (e) {
        console.error("Failed to initiate call:", e);
        showToast("Error initiating call. Ensure the remote ID is online.", "error");
        updateStatus("Call Failed", "disconnected");
    }
}

/**
 * Handles an incoming WebRTC call from a remote peer.
 * Automatically answers the call with the local media stream.
 * 
 * @param {MediaConnection} call - The incoming PeerJS MediaConnection object.
 */
function handleIncomingCall(call) {
    try {
        remotePeerId = call.peer;
        remoteIdInput.value = call.peer;
        call.answer(localStream);
        setupCallEvents(call);
    } catch (e) {
        console.error("Failed to answer incoming call:", e);
        showToast("Error answering call.", "error");
    }
}

/**
 * Binds lifecycle event listeners (stream, error, close) to a PeerJS MediaConnection.
 * Also invokes state-of-the-art codec manipulation on the underlying RTCPeerConnection.
 * 
 * @param {MediaConnection} call - The active PeerJS MediaConnection.
 */
function setupCallEvents(call) {
    currentCall = call;

    if (call.peerConnection) {
        enforcePreferredCodecs(call.peerConnection);
    }

    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'inline-flex';
    updateCallUIState(true);

    call.on('stream', (remoteStream) => {
        console.log('Remote MediaStream received.');
        remoteVideo.srcObject = remoteStream;
        
        const upscaleCanvas = document.getElementById('upscale-canvas');
        if (typeof initUpscaler === 'function') {
            initUpscaler(remoteVideo, upscaleCanvas);
        }
        
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
            startTelemetry();
        }
    };
}

function hangUpCall(statusText = 'Call Ended') {
    if (currentCall) {
        currentCall.close();
    }
    stopTelemetry();
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

    updateCallUIState(false);
    stopTelemetry();
    updateStatus(statusMessage || 'Awaiting Connection', statusMessage === 'Connected' ? 'connected' : 'warning');
}

/**
 * Updates the floating panel & dock layout depending on call state (lobby vs in-call).
 * 
 * @param {boolean} inCall - Whether an active call is established.
 */
function updateCallUIState(inCall) {
    const panelTitle = document.getElementById('panel-title');
    const callInfoSection = document.getElementById('call-info-section');
    const preCallSections = document.querySelectorAll('.pre-call-only');
    const dockQualityGroup = document.getElementById('dock-quality-group');
    const dockEndCallGroup = document.getElementById('dock-end-call-group');
    const dockInCallTools = document.getElementById('dock-in-call-tools');
    const callParticipant = document.getElementById('call-participant');

    if (inCall) {
        if (panelTitle) panelTitle.textContent = 'Call Info';
        if (callInfoSection) callInfoSection.classList.remove('hidden');
        preCallSections.forEach(el => el.classList.add('hidden'));
        
        if (dockQualityGroup) dockQualityGroup.classList.add('hidden');
        if (dockEndCallGroup) dockEndCallGroup.classList.remove('hidden');
        if (dockInCallTools) dockInCallTools.classList.remove('hidden');
        
        if (callParticipant) {
            const idToDisplay = remotePeerId ? (remotePeerId.substring(0, 12) + '...') : 'Remote Peer';
            callParticipant.textContent = idToDisplay;
        }

        startCallTimer();
    } else {
        if (panelTitle) panelTitle.textContent = 'Connection Details';
        if (callInfoSection) callInfoSection.classList.add('hidden');
        preCallSections.forEach(el => el.classList.remove('hidden'));
        
        if (dockQualityGroup) dockQualityGroup.classList.remove('hidden');
        if (dockEndCallGroup) dockEndCallGroup.classList.add('hidden');
        if (dockInCallTools) dockInCallTools.classList.add('hidden');

        stopCallTimer();
        if (isScreenSharing) stopScreenShare();
    }
}

/**
 * Starts the live duration timer for active calls.
 */
function startCallTimer() {
    stopCallTimer();
    callStartTime = Date.now();
    const durationEl = document.getElementById('call-duration');
    if (!durationEl) return;

    callTimerInterval = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - callStartTime) / 1000);
        const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
        const secs = String(elapsedSec % 60).padStart(2, '0');
        durationEl.textContent = `${mins}:${secs}`;
    }, 1000);
}

/**
 * Stops the live duration timer and resets display.
 */
function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    const durationEl = document.getElementById('call-duration');
    if (durationEl) durationEl.textContent = '00:00';
}

/**
 * Toggles WebRTC screen sharing using navigator.mediaDevices.getDisplayMedia.
 */
async function toggleScreenShare() {
    if (!currentCall || !currentCall.peerConnection) {
        showToast('Screen sharing is available during an active call.', 'warning');
        return;
    }

    if (isScreenSharing) {
        await stopScreenShare();
    } else {
        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            screenStream = displayStream;
            const screenTrack = displayStream.getVideoTracks()[0];

            const senders = currentCall.peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(screenTrack);
            }

            isScreenSharing = true;
            const screenshareBtn = document.getElementById('screenshare-btn');
            if (screenshareBtn) screenshareBtn.classList.add('inactive');
            showToast('Screen sharing started', 'success');

            screenTrack.onended = () => {
                stopScreenShare();
            };
        } catch (err) {
            console.error('Screen sharing error:', err);
            showToast('Screen sharing cancelled', 'warning');
        }
    }
}

/**
 * Reverts screen share back to local camera hardware.
 */
async function stopScreenShare() {
    if (!isScreenSharing) return;
    isScreenSharing = false;

    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    if (localStream && currentCall && currentCall.peerConnection) {
        const cameraTrack = localStream.getVideoTracks()[0];
        if (cameraTrack) {
            const senders = currentCall.peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(cameraTrack);
            }
        }
    }

    const screenshareBtn = document.getElementById('screenshare-btn');
    if (screenshareBtn) screenshareBtn.classList.remove('inactive');
    showToast('Screen sharing stopped', 'info');
}

// ==========================================
// Telemetry (Bandwidth Monitoring)
// ==========================================

function startTelemetry() {
    if (telemetryIntervalId) clearInterval(telemetryIntervalId);
    lastBytesSent = 0;
    lastBytesReceived = 0;
    lastTimestamp = performance.now();

    telemetryIntervalId = setInterval(async () => {
        if (!currentCall || !currentCall.peerConnection) return;
        
        try {
            const stats = await currentCall.peerConnection.getStats(null);
            let bytesSent = 0;
            let bytesReceived = 0;
            
            stats.forEach(report => {
                if (report.type === 'outbound-rtp' && report.bytesSent) bytesSent += report.bytesSent;
                if (report.type === 'inbound-rtp' && report.bytesReceived) bytesReceived += report.bytesReceived;
            });
            
            const now = performance.now();
            const timeDelta = (now - lastTimestamp) / 1000; // seconds
            
            if (timeDelta > 0) {
                const uploadBps = ((bytesSent - lastBytesSent) * 8) / timeDelta;
                const downloadBps = ((bytesReceived - lastBytesReceived) * 8) / timeDelta;
                
                if (statUpload) statUpload.textContent = (uploadBps / 1000000).toFixed(2) + ' Mbps';
                if (statDownload) statDownload.textContent = (downloadBps / 1000000).toFixed(2) + ' Mbps';
            }
            
            lastBytesSent = bytesSent;
            lastBytesReceived = bytesReceived;
            lastTimestamp = now;
        } catch (e) {
            console.error('Stats polling error', e);
        }
    }, 1000);
}

function stopTelemetry() {
    if (telemetryIntervalId) {
        clearInterval(telemetryIntervalId);
        telemetryIntervalId = null;
    }
    if (statUpload) statUpload.textContent = '0.00 Mbps';
    if (statDownload) statDownload.textContent = '0.00 Mbps';
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

    updatePopoverQualityButtons(qualityLevel);

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
    showToast(`Quality set to ${qualityLevel.charAt(0).toUpperCase() + qualityLevel.slice(1)}`, 'info');
}

// ==========================================
// Codec Enforcement (AV1 / VP9)
// ==========================================

function enforcePreferredCodecs(peerConnection) {
    if (!peerConnection || typeof RTCRtpReceiver === 'undefined' || !('getCapabilities' in RTCRtpReceiver)) {
        return;
    }

    try {
        // --- Video Codec Enforcement (AV1 -> VP9 -> H264) ---
        const videoCapabilities = RTCRtpReceiver.getCapabilities('video');
        let sortedVideoCodecs = null;
        if (videoCapabilities && videoCapabilities.codecs) {
            const preferredVideo = [];
            const otherVideo = [];
            videoCapabilities.codecs.forEach(codec => {
                const mimeType = codec.mimeType.toLowerCase();
                if (mimeType.includes('video/av1')) preferredVideo.push(codec);
                else if (mimeType.includes('video/vp9')) preferredVideo.push(codec);
                else if (mimeType.includes('video/h264')) preferredVideo.push(codec);
                else otherVideo.push(codec);
            });
            if (preferredVideo.length > 0) {
                sortedVideoCodecs = [...preferredVideo, ...otherVideo];
            }
        }

        // --- Audio Codec Enforcement (Opus) ---
        const audioCapabilities = RTCRtpReceiver.getCapabilities('audio');
        let sortedAudioCodecs = null;
        if (audioCapabilities && audioCapabilities.codecs) {
            const preferredAudio = [];
            const otherAudio = [];
            audioCapabilities.codecs.forEach(codec => {
                const mimeType = codec.mimeType.toLowerCase();
                if (mimeType.includes('audio/opus')) {
                    // Force stereo in SDP parameter if we can, but at least prioritize Opus
                    preferredAudio.push(codec);
                } else {
                    otherAudio.push(codec);
                }
            });
            if (preferredAudio.length > 0) {
                sortedAudioCodecs = [...preferredAudio, ...otherAudio];
            }
        }

        // --- Apply Preferences to Transceivers ---
        const transceivers = peerConnection.getTransceivers();
        transceivers.forEach(transceiver => {
            if (!transceiver.receiver || !transceiver.receiver.track) return;
            
            if (transceiver.receiver.track.kind === 'video' && sortedVideoCodecs && typeof transceiver.setCodecPreferences === 'function') {
                transceiver.setCodecPreferences(sortedVideoCodecs);
                console.log(`Video Codec Preferences Enforced. Top preferred: ${sortedVideoCodecs[0].mimeType}`);
            }
            
            if (transceiver.receiver.track.kind === 'audio' && sortedAudioCodecs && typeof transceiver.setCodecPreferences === 'function') {
                transceiver.setCodecPreferences(sortedAudioCodecs);
                console.log(`Audio Codec Preferences Enforced. Top preferred: ${sortedAudioCodecs[0].mimeType}`);
            }
        });
    } catch (e) {
        console.warn('Failed to enforce codecs:', e);
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
    const span = document.createElement('span');
    span.textContent = message;
    toast.appendChild(span);

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

function updatePopoverQualityButtons(qualityLevel) {
    const popoverQualityHigh = document.getElementById('popover-quality-high');
    const popoverQualityMedium = document.getElementById('popover-quality-medium');
    const popoverQualityLow = document.getElementById('popover-quality-low');

    if (popoverQualityHigh) popoverQualityHigh.classList.remove('active');
    if (popoverQualityMedium) popoverQualityMedium.classList.remove('active');
    if (popoverQualityLow) popoverQualityLow.classList.remove('active');

    if (qualityLevel === 'high' && popoverQualityHigh) popoverQualityHigh.classList.add('active');
    if (qualityLevel === 'medium' && popoverQualityMedium) popoverQualityMedium.classList.add('active');
    if (qualityLevel === 'low' && popoverQualityLow) popoverQualityLow.classList.add('active');
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
