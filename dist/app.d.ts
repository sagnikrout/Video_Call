/**
 * Single-Page Peer-to-Peer WebRTC Video Calling Web Application (Darpan)
 * Built with HTML5, CSS3, Vanilla TypeScript, WebRTC, and PeerJS.
 */
declare class Peer {
    id: string;
    constructor(options?: {
        key?: string;
        host?: string;
        port?: number;
        path?: string;
        secure?: boolean;
        config?: RTCConfiguration;
        debug?: number;
    });
    on(event: 'open', callback: (id: string) => void): void;
    on(event: 'call', callback: (call: MediaConnection) => void): void;
    on(event: 'connection', callback: (conn: DataConnection) => void): void;
    on(event: 'disconnected', callback: () => void): void;
    on(event: 'close', callback: () => void): void;
    on(event: 'error', callback: (err: {
        type: string;
        message?: string;
    }) => void): void;
    call(id: string, stream: MediaStream, options?: unknown): MediaConnection;
    connect(id: string, options?: unknown): DataConnection;
    reconnect(): void;
    destroy(): void;
}
interface MediaConnection {
    peer: string;
    open: boolean;
    peerConnection?: RTCPeerConnection;
    answer(stream?: MediaStream): void;
    close(): void;
    on(event: 'stream', callback: (stream: MediaStream) => void): void;
    on(event: 'close', callback: () => void): void;
    on(event: 'error', callback: (err: unknown) => void): void;
}
interface DataConnection {
    peer: string;
    open: boolean;
    send(data: unknown): void;
    close(): void;
    on(event: 'open', callback: () => void): void;
    on(event: 'data', callback: (data: unknown) => void): void;
    on(event: 'close', callback: () => void): void;
    on(event: 'error', callback: (err: unknown) => void): void;
}
type QualityLevel = 'high' | 'medium' | 'low';
type VideoFitMode = 'contain' | 'cover';
type ConnectionBadgeState = 'connected' | 'disconnected' | 'warning';
type ToastType = 'info' | 'success' | 'warning' | 'error';
interface QualityPreset {
    width: number;
    height: number;
    frameRate: number;
    videoMaxBitrate: number;
    audioMaxBitrate: number;
}
interface CornerPosition {
    name: string;
    getPos: (w: number, h: number) => {
        left: number;
        top: number;
    };
}
interface DataSignalMessage {
    type: string;
    [key: string]: unknown;
}
interface Window {
    initUpscaler?: (videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement) => void;
    setVideoFitMode?: (mode: VideoFitMode) => void;
    stopUpscaler?: () => void;
}
declare let peer: Peer | null;
declare let currentCall: MediaConnection | null;
declare let localStream: MediaStream | null;
declare let currentQuality: QualityLevel;
declare let remotePeerId: string;
declare let reconnectTimeoutId: ReturnType<typeof setTimeout> | null;
declare let callStartTime: number | null;
declare let callTimerInterval: ReturnType<typeof setInterval> | null;
declare let isScreenSharing: boolean;
declare let screenStream: MediaStream | null;
declare let dataConnection: DataConnection | null;
declare let isIntentionalDisconnect: boolean;
declare let qualityChangeQueue: Promise<void>;
declare const QUALITY_PRESETS: Record<QualityLevel, QualityPreset>;
declare const localVideo: HTMLVideoElement;
declare const remoteVideo: HTMLVideoElement;
declare const myIdDisplay: HTMLElement;
declare const copyIdBtn: HTMLButtonElement;
declare const remoteIdInput: HTMLInputElement;
declare const connectBtn: HTMLButtonElement;
declare const disconnectBtn: HTMLButtonElement;
declare const toggleMicBtn: HTMLButtonElement;
declare const toggleCamBtn: HTMLButtonElement;
declare const connectionStatus: HTMLElement;
declare const statusBadge: HTMLElement;
declare const remoteVideoPlaceholder: HTMLElement;
declare const btnQualityHigh: HTMLButtonElement;
declare const btnQualityMedium: HTMLButtonElement;
declare const btnQualityLow: HTMLButtonElement;
declare const micSelect: HTMLSelectElement;
declare const cameraSelect: HTMLSelectElement;
declare const toastContainer: HTMLElement;
declare const infoBtn: HTMLButtonElement;
declare const infoPanel: HTMLElement;
declare const closeInfoBtn: HTMLButtonElement;
declare const statUpload: HTMLElement;
declare const statDownload: HTMLElement;
declare let telemetryIntervalId: ReturnType<typeof setInterval> | null;
declare let lastBytesSent: number;
declare let lastBytesReceived: number;
declare let lastTimestamp: number;
declare let upscalerAnimationFrameId: number | null;
declare let currentVideoFitMode: VideoFitMode;
/**
 * Initializes the WebGL spatial interpolation upscaler.
 * Applies a 3x3 Convolution Matrix (Laplacian edge enhancement) to video stream.
 */
declare function initUpscaler(videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement): void;
/**
 * Halts the WebGL render loop and frees background animation resources.
 */
declare function stopUpscaler(): void;
/**
 * Updates the WebGL video view mode ('contain' = Fit to Frame uncropped, 'cover' = Fill Screen).
 */
declare function setVideoFitMode(mode: VideoFitMode): void;
/**
 * Main initialization workflow: setup event listeners, PeerJS signaling, drag engine, and request media hardware.
 */
declare function initializeApplication(): Promise<void>;
/**
 * Enables smooth drag and corner snapping behavior on target floating PIP tile.
 */
declare function makeElementDraggable(el: HTMLElement): void;
/**
 * Instantiates the PeerJS object and binds signaling connection events.
 * Configured with multi-region STUN + OpenRelay TURN servers for NAT traversal.
 */
declare function initializePeer(): void;
/**
 * Binds signaling listeners to a companion PeerJS DataConnection for synchronized disconnection.
 */
declare function setupDataConnection(conn: DataConnection): void;
/**
 * Requests camera and microphone hardware access via navigator.mediaDevices.getUserMedia.
 */
declare function requestMediaPermissions(): Promise<void>;
/**
 * Toggles a target dock popover and closes all other open popovers.
 */
declare function togglePopover(targetPopover: HTMLElement | null): void;
/**
 * Closes all open dock popovers.
 */
declare function closeAllPopovers(): void;
declare function syncPopoverAria(): void;
/**
 * Enumerates connected media devices and populates microphone and camera selection dropdowns & popovers.
 */
declare function populateDeviceLists(): Promise<void>;
/**
 * Dynamically switches active microphone hardware input without tearing down the WebRTC connection.
 */
declare function switchMicrophone(deviceId: string): Promise<void>;
/**
 * Dynamically switches active camera hardware input without tearing down the WebRTC connection.
 */
declare function switchCamera(deviceId: string): Promise<void>;
/**
 * Sets up global DOM event listeners for buttons, popovers, and device toggles.
 */
declare function setupEventListeners(): void;
declare function handleMicrophoneToggle(): void;
declare function handleCameraToggle(): void;
/**
 * Initiates an outgoing WebRTC call to a specified remote peer.
 */
declare function initiateCall(remoteId: string): void;
/**
 * Handles an incoming WebRTC call from a remote peer.
 */
declare function handleIncomingCall(call: MediaConnection): void;
/**
 * Binds lifecycle event listeners to an active PeerJS MediaConnection.
 */
declare function setupCallEvents(call: MediaConnection): void;
/**
 * Attaches a remote MediaStream to the remote video element and initializes post-processing.
 */
declare function attachRemoteStream(stream: MediaStream): void;
declare function monitorIceConnectionState(peerConnection: RTCPeerConnection): void;
declare function hangUpCall(statusText?: string): void;
declare function resetCallUI(statusMessage?: string): void;
/**
 * Updates the floating panel & dock layout depending on call state (lobby vs in-call).
 */
declare function updateCallUIState(inCall: boolean): void;
/**
 * Starts the live duration timer for active calls.
 */
declare function startCallTimer(): void;
/**
 * Stops the live duration timer and resets display.
 */
declare function stopCallTimer(): void;
/**
 * Toggles WebRTC screen sharing using navigator.mediaDevices.getDisplayMedia.
 */
declare function toggleScreenShare(): Promise<void>;
/**
 * Reverts screen share back to local camera hardware.
 */
declare function stopScreenShare(): Promise<void>;
declare function startTelemetry(): void;
declare function stopTelemetry(): void;
declare function setMediaQuality(qualityLevel: QualityLevel): Promise<void>;
declare function executeQualityChange(qualityLevel: QualityLevel): Promise<void>;
declare function enforcePreferredCodecs(peerConnection: RTCPeerConnection): void;
declare function updateStatus(message: string, state?: ConnectionBadgeState): void;
declare function showToast(message: string, type?: ToastType): void;
declare function copyToClipboard(text: string): void;
declare function fallbackCopy(text: string): void;
declare function updatePopoverQualityButtons(qualityLevel: QualityLevel): void;
declare function cleanupResources(): void;
