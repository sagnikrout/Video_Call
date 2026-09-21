"use strict";
/**
 * Single-Page Peer-to-Peer WebRTC Video Calling Web Application (Darpan)
 * Built with HTML5, CSS3, Vanilla TypeScript, WebRTC, and PeerJS.
 */
// ==========================================
// Global Application State Variables
// ==========================================
let peer = null;
let currentCall = null;
let localStream = null;
let currentQuality = 'medium';
let remotePeerId = '';
let reconnectTimeoutId = null;
// In-Call UX & Audio Dynamics State
let callStartTime = null;
let callTimerInterval = null;
let isMonochromeMode = true;
// Auto-Talk Full-Duplex Audio Engine state
let audioContext = null;
let localAudioSource = null;
let localCompressorNode = null;
let localHighpassNode = null;
let localPresenceNode = null;
let localDestinationNode = null;
let localAnalyserNode = null;
let remoteAnalyserNode = null;
let speechDetectionInterval = null;
// Companion Data Connection & Disconnect Synchronization
let dataConnection = null;
let isIntentionalDisconnect = false;
// Permanent Cryptographic Darpan Identifier (Base36, 20-char: 36^20 ≈ 1.33×10^31 combinations) & Ephemeral Session State
let localDarpanId = '';
let activeEphemeralSessionId = null;
/**
 * Generates a cryptographically secure 20-character Base36 identifier.
 * Alphabet: 0-9 A-Z (case-insensitive). Space: 36^20 ≈ 1.33×10^31 combinations (~104 bits entropy).
 * Birthday Paradox collision probability across 10 billion humans: P < 3.8×10^-12 (1 in 260 billion).
 */
function generateSecureBase36Id() {
    const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const array = new Uint8Array(20);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => CHARS[b % 36]).join('');
}
/**
 * Retrieves the user's permanent Darpan identifier from sessionStorage/localStorage,
 * or cryptographically generates a fresh Base36 ID and persists it.
 */
function getOrCreatePermanentId() {
    try {
        const sessionStored = sessionStorage.getItem('darpan_permanent_id');
        if (sessionStored && /^[0-9A-Z]{20}$/i.test(sessionStored)) {
            return sessionStored.toUpperCase();
        }
        const freshId = generateSecureBase36Id();
        sessionStorage.setItem('darpan_permanent_id', freshId);
        localStorage.setItem('darpan_permanent_id', freshId);
        return freshId;
    }
    catch (e) {
        return generateSecureBase36Id();
    }
}
/**
 * Formats a Base36 string into clean 4-character groups (XXXX-XXXX-XXXX-XXXX-XXXX).
 * Output is always uppercase. Input may contain dashes or mixed case.
 */
function formatDarpanId(id) {
    const cleaned = cleanDarpanId(id);
    const chunks = cleaned.match(/.{1,4}/g);
    return chunks ? chunks.join('-') : id.toUpperCase();
}
/**
 * Strips dashes, spaces, and the darpan- prefix; normalizes to uppercase Base36.
 */
function cleanDarpanId(input) {
    if (!input)
        return '';
    return input.replace(/^darpan-/i, '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
}
// Asynchronous mutex chain to queue quality modifications and prevent concurrent setParameters calls
let qualityChangeQueue = Promise.resolve();
// Optimal sqrt(2) : 1 Sensor Geometry (1528 x 1080) - 94.3% Physical Silicon Harvest
const QUALITY_PRESETS = {
    high: {
        width: 1528,
        height: 1080,
        frameRate: 60, // 60 fps Ultra HFR (Strict >= 30 fps hardware floor)
        videoMaxBitrate: 6000000, // 6.0 Mbps Ultra 1080p
        audioMaxBitrate: 256000 // 256 kbps
    },
    medium: {
        width: 1528,
        height: 1080,
        frameRate: 30, // 30 fps carrier -> 60 fps extrapolated (Strict >= 30 fps floor)
        videoMaxBitrate: 4500000, // 4.5 Mbps Studio 1080p
        audioMaxBitrate: 128000 // 128 kbps
    },
    low: {
        width: 1528,
        height: 1080,
        frameRate: 30, // 30 fps carrier (Strict floor: nothing less than 30 fps)
        videoMaxBitrate: 2500000, // 2.5 Mbps Eco 1080p
        audioMaxBitrate: 64000 // 64 kbps
    }
};
// ==========================================
// Cached DOM Elements
// ==========================================
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
// WebGL Spatial Upscaler & Video Shader Engine
// ==========================================
let upscalerAnimationFrameId = null;
let currentVideoFitMode = 'contain';
/**
 * Initializes the WebGL spatial interpolation upscaler.
 * Applies a 3x3 Convolution Matrix (Laplacian edge enhancement) to video stream.
 */
function initUpscaler(videoElement, canvasElement) {
    if (!videoElement || !canvasElement)
        return;
    stopUpscaler();
    try {
        const gl = (canvasElement.getContext('webgl2') || canvasElement.getContext('webgl'));
        if (!gl) {
            console.warn("WebGL not supported, falling back to standard video rendering.");
            canvasElement.style.display = 'none';
            videoElement.style.display = 'block';
            return;
        }
        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
            }
        `;
        const fsSource = `
            precision mediump float;
            uniform sampler2D u_imageCurr;
            uniform sampler2D u_imagePrev;
            uniform float u_temporalPhase;
            uniform float u_time;
            uniform vec2 u_resolution;
            uniform vec2 u_scale;
            varying vec2 v_texCoord;

            // Rec.709 ITU High-Precision Luma Weights for Pure Monochrom
            const vec3 lumaWeights = vec3(0.2126, 0.7152, 0.0722);

            float getLuma(vec4 color) {
                return dot(color.rgb, lumaWeights);
            }

            // High-frequency pseudo-random hash for organic 35mm silver-halide micro-grain
            float hash21(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return fract(p.x * p.y);
            }

            // Leica Monochrom filmic tone curve: gentle shadow toe, rich midtones, soft highlight shoulder
            float filmicTone(float x) {
                x = clamp(x, 0.0, 1.0);
                // Cubic Hermite S-curve
                float s = x * x * (3.0 - 2.0 * x);
                // Blend between linear and filmic curve for optimal portrait contrast
                return mix(x, s, 0.72);
            }

            void main() {
                vec2 uv = (v_texCoord - 0.5) * u_scale + 0.5;

                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }

                vec2 texelSize = 1.0 / u_resolution;
                
                // 1. Physical RGB Subpixel Horizontal Displacement (-1/3 texel, 0, +1/3 texel)
                float subOffset = texelSize.x * 0.333333;
                vec2 uvR = uv - vec2(subOffset, 0.0);
                vec2 uvG = uv;
                vec2 uvB = uv + vec2(subOffset, 0.0);

                // 2. Optical Flow Motion Vector Estimation between frames
                float lumaPrev = getLuma(texture2D(u_imagePrev, uv));
                float lumaCurr = getLuma(texture2D(u_imageCurr, uv));
                
                float lumaX = (getLuma(texture2D(u_imageCurr, uv + vec2(texelSize.x, 0.0))) -
                               getLuma(texture2D(u_imageCurr, uv - vec2(texelSize.x, 0.0)))) * 0.5;
                float lumaY = (getLuma(texture2D(u_imageCurr, uv + vec2(0.0, texelSize.y))) -
                               getLuma(texture2D(u_imageCurr, uv - vec2(0.0, texelSize.y)))) * 0.5;

                vec2 grad = vec2(lumaX, lumaY);
                float gradSq = dot(grad, grad) + 0.0001;
                float lumaDelta = lumaCurr - lumaPrev;

                // Motion vector clamped to ensure clean stability
                vec2 motionVec = clamp(-((lumaDelta * grad) / gradSq) * texelSize, -texelSize * 3.0, texelSize * 3.0);

                // 3. Forward Motion Vector Extrapolation (30 fps -> 60 fps double-rate synthesis)
                vec2 offsetPrev = motionVec * (1.0 - u_temporalPhase * 0.5);
                vec2 offsetCurr = -motionVec * (u_temporalPhase * 0.5);

                // Subpixel sampling for Red, Green, Blue channels
                float centerR = mix(getLuma(texture2D(u_imagePrev, uvR + offsetPrev)),
                                    getLuma(texture2D(u_imageCurr, uvR + offsetCurr)), u_temporalPhase);
                float centerG = mix(getLuma(texture2D(u_imagePrev, uvG + offsetPrev)),
                                    getLuma(texture2D(u_imageCurr, uvG + offsetCurr)), u_temporalPhase);
                float centerB = mix(getLuma(texture2D(u_imagePrev, uvB + offsetPrev)),
                                    getLuma(texture2D(u_imageCurr, uvB + offsetCurr)), u_temporalPhase);

                // 4. Isotropic 8-Neighbor Spatial Deconvolution (Unsharp Mask Kernel)
                // Orthogonal samples (weight 1.0)
                float top    = mix(getLuma(texture2D(u_imagePrev, uv + vec2(0.0, -texelSize.y) + offsetPrev)),
                                   getLuma(texture2D(u_imageCurr, uv + vec2(0.0, -texelSize.y) + offsetCurr)), u_temporalPhase);
                float bottom = mix(getLuma(texture2D(u_imagePrev, uv + vec2(0.0,  texelSize.y) + offsetPrev)),
                                   getLuma(texture2D(u_imageCurr, uv + vec2(0.0,  texelSize.y) + offsetCurr)), u_temporalPhase);
                float left   = mix(getLuma(texture2D(u_imagePrev, uv + vec2(-texelSize.x, 0.0) + offsetPrev)),
                                   getLuma(texture2D(u_imageCurr, uv + vec2(-texelSize.x, 0.0) + offsetCurr)), u_temporalPhase);
                float right  = mix(getLuma(texture2D(u_imagePrev, uv + vec2( texelSize.x, 0.0) + offsetPrev)),
                                   getLuma(texture2D(u_imageCurr, uv + vec2( texelSize.x, 0.0) + offsetCurr)), u_temporalPhase);

                // Diagonal samples (weight 0.7071 for true radial isotropy)
                float tl = mix(getLuma(texture2D(u_imagePrev, uv + vec2(-texelSize.x, -texelSize.y) + offsetPrev)),
                               getLuma(texture2D(u_imageCurr, uv + vec2(-texelSize.x, -texelSize.y) + offsetCurr)), u_temporalPhase);
                float tr = mix(getLuma(texture2D(u_imagePrev, uv + vec2( texelSize.x, -texelSize.y) + offsetPrev)),
                               getLuma(texture2D(u_imageCurr, uv + vec2( texelSize.x, -texelSize.y) + offsetCurr)), u_temporalPhase);
                float bl = mix(getLuma(texture2D(u_imagePrev, uv + vec2(-texelSize.x,  texelSize.y) + offsetPrev)),
                               getLuma(texture2D(u_imageCurr, uv + vec2(-texelSize.x,  texelSize.y) + offsetCurr)), u_temporalPhase);
                float br = mix(getLuma(texture2D(u_imagePrev, uv + vec2( texelSize.x,  texelSize.y) + offsetPrev)),
                               getLuma(texture2D(u_imageCurr, uv + vec2( texelSize.x,  texelSize.y) + offsetCurr)), u_temporalPhase);

                // Total weight = 4 * 1.0 + 4 * 0.70710678 = 6.828427
                float surround = ((top + bottom + left + right) + (tl + tr + bl + br) * 0.70710678) * 0.1464466;

                // Deconvolution edge sharpening
                const float sharpness = 0.32;
                float lumR = centerR + (centerR - surround) * sharpness;
                float lumG = centerG + (centerG - surround) * sharpness;
                float lumB = centerB + (centerB - surround) * sharpness;

                // 5. Specular Halation Bloom (Ethereal photonic glow on highlights > 0.72)
                float highlightExcess = max(0.0, surround - 0.72);
                float bloom = highlightExcess * highlightExcess * 0.55;
                lumR += bloom;
                lumG += bloom;
                lumB += bloom;

                // 6. Leica Monochrom Filmic S-Curve Tone Mapping
                lumR = filmicTone(lumR);
                lumG = filmicTone(lumG);
                lumB = filmicTone(lumB);

                // 7. 35mm Silver-Halide Organic Micro-Grain (Sub-perceptual dither)
                // Modulated by screen coordinate hash and temporal phase
                float grain = (hash21(gl_FragCoord.xy + fract(u_time * 23.456)) - 0.5);
                // Micro-grain is strongest in midtones, gracefully attenuating in deep blacks and bright highlights
                float midtoneMask = 1.0 - 2.0 * abs(lumG - 0.5);
                midtoneMask = max(0.0, midtoneMask);
                float grainAmt = grain * 0.024 * midtoneMask;

                vec3 finalLum = vec3(lumR + grainAmt, lumG + grainAmt, lumB + grainAmt);

                // Output physical subpixel grayscale matrix
                gl_FragColor = vec4(clamp(finalLum, 0.0, 1.0), 1.0);
            }
        `;
        function compileShader(context, type, source) {
            const shader = context.createShader(type);
            if (!shader)
                return null;
            context.shaderSource(shader, source);
            context.compileShader(shader);
            if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
                console.error("Shader compile error:", context.getShaderInfoLog(shader));
                context.deleteShader(shader);
                return null;
            }
            return shader;
        }
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vertexShader || !fragmentShader)
            return;
        const shaderProgram = gl.createProgram();
        if (!shaderProgram)
            return;
        gl.attachShader(shaderProgram, vertexShader);
        gl.attachShader(shaderProgram, fragmentShader);
        gl.linkProgram(shaderProgram);
        if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            throw new Error("Unable to link shader program: " + gl.getProgramInfoLog(shaderProgram));
        }
        gl.useProgram(shaderProgram);
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = [
            -1.0, 1.0,
            1.0, 1.0,
            -1.0, -1.0,
            1.0, -1.0,
        ];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        const texCoords = [
            0.0, 0.0,
            1.0, 0.0,
            0.0, 1.0,
            1.0, 1.0,
        ];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
        const positionLocation = gl.getAttribLocation(shaderProgram, "a_position");
        gl.enableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        const texCoordLocation = gl.getAttribLocation(shaderProgram, "a_texCoord");
        gl.enableVertexAttribArray(texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
        let textureCurr = gl.createTexture();
        let texturePrev = gl.createTexture();
        function configureTexture(tex) {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
        configureTexture(textureCurr);
        configureTexture(texturePrev);
        const resolutionLocation = gl.getUniformLocation(shaderProgram, "u_resolution");
        const scaleLocation = gl.getUniformLocation(shaderProgram, "u_scale");
        const imageCurrLocation = gl.getUniformLocation(shaderProgram, "u_imageCurr");
        const imagePrevLocation = gl.getUniformLocation(shaderProgram, "u_imagePrev");
        const temporalPhaseLocation = gl.getUniformLocation(shaderProgram, "u_temporalPhase");
        const timeLocation = gl.getUniformLocation(shaderProgram, "u_time");
        let lastVideoTime = -1;
        let frameStartTime = performance.now();
        let estimatedFrameDuration = 33.33; // Default 30fps carrier interval (33.33ms, nothing less than 30fps)
        function renderLoop() {
            if (!videoElement.paused && !videoElement.ended && videoElement.videoWidth > 0) {
                const displayWidth = canvasElement.clientWidth * (window.devicePixelRatio || 1);
                const displayHeight = canvasElement.clientHeight * (window.devicePixelRatio || 1);
                if (canvasElement.width !== displayWidth || canvasElement.height !== displayHeight) {
                    canvasElement.width = displayWidth;
                    canvasElement.height = displayHeight;
                    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
                }
                const now = performance.now();
                // Detect when a new camera/network frame arrives
                if (videoElement.currentTime !== lastVideoTime) {
                    if (lastVideoTime >= 0) {
                        const delta = now - frameStartTime;
                        if (delta > 10 && delta < 250) {
                            estimatedFrameDuration = estimatedFrameDuration * 0.7 + delta * 0.3;
                        }
                    }
                    frameStartTime = now;
                    lastVideoTime = videoElement.currentTime;
                    // Ping-pong swap: previous texture becomes old current, new frame goes to current
                    const temp = texturePrev;
                    texturePrev = textureCurr;
                    textureCurr = temp;
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, textureCurr);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);
                }
                // Compute smooth temporal motion extrapolation phase for 60 FPS double-rate rendering
                const elapsed = now - frameStartTime;
                const alpha = Math.min(Math.max(elapsed / Math.max(estimatedFrameDuration, 16.0), 0.0), 1.0);
                // Bind current frame to texture unit 0
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, textureCurr);
                gl.uniform1i(imageCurrLocation, 0);
                // Bind previous frame to texture unit 1
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, texturePrev);
                gl.uniform1i(imagePrevLocation, 1);
                gl.uniform1f(temporalPhaseLocation, alpha);
                gl.uniform1f(timeLocation, now * 0.001);
                gl.uniform2f(resolutionLocation, videoElement.videoWidth, videoElement.videoHeight);
                const canvasAspect = displayWidth / displayHeight;
                const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
                let scaleX = 1.0;
                let scaleY = 1.0;
                // Epsilon snap to eliminate subpixel floating-point rounding edge cases when aspect ratios match
                if (Math.abs(videoAspect - canvasAspect) > 0.005) {
                    if (currentVideoFitMode === 'cover') {
                        if (videoAspect > canvasAspect) {
                            scaleX = canvasAspect / videoAspect;
                        }
                        else {
                            scaleY = videoAspect / canvasAspect;
                        }
                    }
                    else {
                        if (videoAspect > canvasAspect) {
                            scaleY = videoAspect / canvasAspect;
                        }
                        else {
                            scaleX = canvasAspect / videoAspect;
                        }
                    }
                }
                gl.uniform2f(scaleLocation, scaleX, scaleY);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            upscalerAnimationFrameId = requestAnimationFrame(renderLoop);
        }
        videoElement.addEventListener('play', () => {
            renderLoop();
        });
        if (!videoElement.paused) {
            renderLoop();
        }
    }
    catch (e) {
        console.error('WebGL Rendering Engine Failed:', e);
        canvasElement.style.display = 'none';
        videoElement.style.display = 'block';
    }
}
/**
 * Halts the WebGL render loop and frees background animation resources.
 */
function stopUpscaler() {
    if (upscalerAnimationFrameId !== null) {
        cancelAnimationFrame(upscalerAnimationFrameId);
        upscalerAnimationFrameId = null;
    }
    const canvasElement = document.getElementById('upscale-canvas');
    if (canvasElement) {
        const gl = (canvasElement.getContext('webgl2') || canvasElement.getContext('webgl'));
        if (gl) {
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
    }
}
/**
 * Updates the WebGL video view mode ('contain' = Fit to Frame uncropped, 'cover' = Fill Screen).
 */
function setVideoFitMode(mode) {
    if (mode === 'contain' || mode === 'cover') {
        currentVideoFitMode = mode;
        console.log(`WebGL Video Fit Mode set to: ${mode}`);
    }
}
/**
 * Activates or deactivates Monochromatic (B&W) low-bandwidth rendering mode.
 */
function setMonochromeMode(enable) {
    isMonochromeMode = enable;
    const remoteVid = document.getElementById('remote-video');
    const upscaleCvs = document.getElementById('upscale-canvas');
    const localVid = document.getElementById('local-video');
    [remoteVid, upscaleCvs, localVid].forEach(el => {
        if (el) {
            if (enable)
                el.classList.add('monochrome-mode');
            else
                el.classList.remove('monochrome-mode');
        }
    });
}
// Global exposure for backward compatibility
window.initUpscaler = initUpscaler;
window.setVideoFitMode = setVideoFitMode;
window.stopUpscaler = stopUpscaler;
window.setMonochromeMode = setMonochromeMode;
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
    setMonochromeMode(true);
    setupEventListeners();
    initializePeer();
    const localVideoTile = document.getElementById('local-video-tile');
    if (localVideoTile)
        makeElementDraggable(localVideoTile);
    await requestMediaPermissions();
}
/**
 * Enables smooth drag and corner snapping behavior on target floating PIP tile.
 */
function makeElementDraggable(el) {
    if (!el)
        return;
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    el.addEventListener('mousedown', dragStart);
    el.addEventListener('touchstart', dragStart, { passive: false });
    function dragStart(e) {
        const target = e.target;
        if (target.tagName === 'BUTTON' || target.tagName === 'SELECT')
            return;
        isDragging = true;
        el.classList.add('dragging');
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        startX = clientX;
        startY = clientY;
        const rect = el.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        document.addEventListener('mousemove', dragMove);
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);
        document.addEventListener('touchcancel', dragEnd);
    }
    function dragMove(e) {
        if (!isDragging)
            return;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
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
        if (e.cancelable)
            e.preventDefault();
    }
    function dragEnd() {
        if (!isDragging)
            return;
        isDragging = false;
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', dragMove);
        document.removeEventListener('touchmove', dragMove);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('touchend', dragEnd);
        document.removeEventListener('touchcancel', dragEnd);
    }
    // Double-click to cycle corners: Top-Right -> Top-Left -> Bottom-Left -> Bottom-Right
    let currentCornerIndex = 0;
    const corners = [
        { name: 'Top-Left', getPos: (_w, _h) => ({ left: 24, top: 24 }) },
        { name: 'Bottom-Left', getPos: (_w, h) => ({ left: 24, top: window.innerHeight - h - 24 }) },
        { name: 'Bottom-Right', getPos: (w, h) => ({ left: window.innerWidth - w - 24, top: window.innerHeight - h - 24 }) },
        { name: 'Top-Right', getPos: (w, _h) => ({ left: window.innerWidth - w - 24, top: 24 }) }
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
 * Configured with multi-region STUN + OpenRelay TURN servers for NAT traversal.
 */
function initializePeer() {
    updateStatus('Connecting to signaling server...', 'warning');
    localDarpanId = getOrCreatePermanentId();
    const signalingId = 'darpan-' + localDarpanId;
    peer = new Peer(signalingId, {
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:443',
                        'turns:openrelay.metered.ca:443'
                    ],
                    username: 'openrelay',
                    credential: 'openrelay'
                }
            ]
        }
    });
    peer.on('open', (id) => {
        console.log('PeerJS connection open. Assigned Local Peer ID:', id);
        const displayId = formatDarpanId(localDarpanId);
        if (myIdDisplay)
            myIdDisplay.textContent = displayId;
        updateStatus('Awaiting Connection', 'warning');
        showToast('Darpan Number registered: ' + displayId, 'success');
    });
    peer.on('call', (incomingCall) => {
        console.log('Incoming call received from:', incomingCall.peer);
        handleIncomingCall(incomingCall);
    });
    peer.on('connection', (conn) => {
        console.log('Incoming DataConnection received from:', conn.peer);
        setupDataConnection(conn);
    });
    peer.on('disconnected', () => {
        console.warn('Disconnected from PeerJS signaling server. Attempting auto-reconnection...');
        updateStatus('Reconnecting to server...', 'warning');
        showToast('Signaling server disconnected. Reconnecting...', 'warning');
        peer?.reconnect();
    });
    peer.on('error', (err) => {
        console.error('PeerJS signaling error:', err);
        if (err.type === 'peer-unavailable') {
            showToast('Could not connect to peer', 'error');
            updateStatus('Peer Unavailable', 'disconnected');
        }
        else if (err.type === 'unavailable-id') {
            console.warn('ID collision on signaling server. Regenerating Darpan ID...');
            const freshId = generateSecureBase36Id();
            sessionStorage.setItem('darpan_permanent_id', freshId);
            localStorage.setItem('darpan_permanent_id', freshId);
            localDarpanId = freshId;
            try {
                peer?.destroy();
            }
            catch (e) { }
            initializePeer();
        }
        else {
            showToast(`Signaling Error: ${err.type}`, 'error');
            updateStatus(`Error: ${err.type}`, 'disconnected');
        }
    });
}
/**
 * Binds signaling listeners to a companion PeerJS DataConnection for synchronized disconnection.
 */
function setupDataConnection(conn) {
    // Strict 2-Person Exclusivity: Reject third-party connection if already in active call
    if (dataConnection !== null && dataConnection.open && dataConnection.peer !== conn.peer) {
        console.warn('Rejecting third-party DataConnection from:', conn.peer);
        try {
            conn.send({ type: 'BUSY_REJECT', reason: 'User is in an exclusive 1-on-1 call' });
        }
        catch (e) { }
        setTimeout(() => conn.close(), 100);
        return;
    }
    dataConnection = conn;
    conn.on('open', () => {
        console.log('Companion DataConnection established with remote peer.');
        if (activeEphemeralSessionId) {
            conn.send({
                type: 'HANDSHAKE_INIT',
                sessionId: activeEphemeralSessionId,
                senderId: localDarpanId,
                timestamp: Date.now()
            });
        }
    });
    conn.on('data', (data) => {
        console.log('DataConnection message received:', data);
        const msg = data;
        if (msg) {
            if (msg.type === 'end-call') {
                isIntentionalDisconnect = true;
                showToast('Remote user ended the call', 'warning');
                resetCallUI('Remote user disconnected');
            }
            else if (msg.type === 'BUSY_REJECT') {
                showToast('Remote user is currently in another call (Busy)', 'warning');
                resetCallUI('Remote user busy');
            }
            else if (msg.type === 'HANDSHAKE_INIT') {
                if (!activeEphemeralSessionId) {
                    activeEphemeralSessionId = msg.sessionId;
                }
                conn.send({
                    type: 'HANDSHAKE_ACK',
                    sessionId: activeEphemeralSessionId,
                    recipientId: localDarpanId
                });
            }
        }
    });
    conn.on('close', () => {
        console.log('DataConnection closed.');
    });
    conn.on('error', (err) => {
        console.warn('DataConnection error:', err);
    });
}
/**
 * Auto-Talk Full-Duplex Audio Engine:
 * Processes microphone audio with high-pass filtering (80Hz rumble cut),
 * dynamic range compression (auto-leveling whispers and shouting),
 * and real-time speech activity detection for visual speaking auras.
 */
function setupAutoTalkAudioEngine(stream) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx)
            return;
        if (!audioContext) {
            audioContext = new AudioCtx();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(() => { });
        }
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0)
            return;
        if (localAudioSource) {
            try {
                localAudioSource.disconnect();
            }
            catch (e) { }
        }
        localAudioSource = audioContext.createMediaStreamSource(stream);
        localHighpassNode = audioContext.createBiquadFilter();
        localHighpassNode.type = 'highpass';
        localHighpassNode.frequency.value = 80;
        // Vocal Presence Peaking EQ (+2.2 dB at 3.2 kHz, Q=1.4) for crisp vocal intelligibility and intimacy
        localPresenceNode = audioContext.createBiquadFilter();
        localPresenceNode.type = 'peaking';
        localPresenceNode.frequency.value = 3200;
        localPresenceNode.Q.value = 1.4;
        localPresenceNode.gain.value = 2.2;
        localCompressorNode = audioContext.createDynamicsCompressor();
        localCompressorNode.threshold.value = -24;
        localCompressorNode.knee.value = 12;
        localCompressorNode.ratio.value = 4;
        localCompressorNode.attack.value = 0.003;
        localCompressorNode.release.value = 0.25;
        localAnalyserNode = audioContext.createAnalyser();
        localAnalyserNode.fftSize = 256;
        localAnalyserNode.smoothingTimeConstant = 0.4;
        localAudioSource.connect(localHighpassNode);
        localHighpassNode.connect(localPresenceNode);
        localPresenceNode.connect(localCompressorNode);
        localCompressorNode.connect(localAnalyserNode);
        startSpeechActivityDetection();
        console.log('Auto-Talk Full-Duplex Audio Engine active.');
    }
    catch (e) {
        console.warn('Auto-Talk audio engine setup warning:', e);
    }
}
function setupRemoteAudioAnalysis(stream) {
    try {
        if (!audioContext) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx)
                audioContext = new AudioCtx();
        }
        if (!audioContext)
            return;
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(() => { });
        }
        if (stream.getAudioTracks().length > 0) {
            const remoteSource = audioContext.createMediaStreamSource(stream);
            remoteAnalyserNode = audioContext.createAnalyser();
            remoteAnalyserNode.fftSize = 256;
            remoteAnalyserNode.smoothingTimeConstant = 0.4;
            remoteSource.connect(remoteAnalyserNode);
            console.log('Remote audio speech tracking initialized.');
        }
    }
    catch (e) {
        console.warn('Remote audio analysis warning:', e);
    }
}
function startSpeechActivityDetection() {
    if (speechDetectionInterval)
        return;
    const localTile = document.getElementById('local-video-tile');
    const remoteContainer = document.getElementById('video-container');
    const dataLocal = new Uint8Array(128);
    const dataRemote = new Uint8Array(128);
    speechDetectionInterval = setInterval(() => {
        if (localAnalyserNode && localStream && localStream.getAudioTracks().some(t => t.enabled)) {
            localAnalyserNode.getByteFrequencyData(dataLocal);
            let sum = 0;
            for (let i = 0; i < dataLocal.length; i++)
                sum += dataLocal[i];
            const avg = sum / dataLocal.length;
            if (localTile) {
                if (avg > 16)
                    localTile.classList.add('speaking-aura');
                else
                    localTile.classList.remove('speaking-aura');
            }
        }
        if (remoteAnalyserNode) {
            remoteAnalyserNode.getByteFrequencyData(dataRemote);
            let sumR = 0;
            for (let i = 0; i < dataRemote.length; i++)
                sumR += dataRemote[i];
            const avgR = sumR / dataRemote.length;
            if (remoteContainer) {
                if (avgR > 16)
                    remoteContainer.classList.add('speaking-aura');
                else
                    remoteContainer.classList.remove('speaking-aura');
            }
        }
    }, 100);
}
/**
 * Requests camera and microphone hardware access via navigator.mediaDevices.getUserMedia.
 */
async function requestMediaPermissions() {
    try {
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const videoConstraints = isMobileDevice
            ? {
                aspectRatio: { ideal: 1.41421356 },
                frameRate: { ideal: QUALITY_PRESETS.medium.frameRate },
                facingMode: { ideal: 'user' }
            }
            : {
                width: { ideal: QUALITY_PRESETS.medium.width },
                height: { ideal: QUALITY_PRESETS.medium.height },
                aspectRatio: { ideal: 1.41421356 },
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
        localStream = stream;
        if (localVideo)
            localVideo.srcObject = stream;
        setupAutoTalkAudioEngine(stream);
        const localCamAvatar = document.getElementById('local-cam-off-avatar');
        if (localCamAvatar)
            localCamAvatar.classList.add('hidden');
        await populateDeviceLists();
        if (navigator.mediaDevices.ondevicechange !== undefined) {
            navigator.mediaDevices.ondevicechange = () => populateDeviceLists();
        }
        await setMediaQuality('medium');
        console.log('User granted camera & microphone access. Local stream initialized.');
    }
    catch (error) {
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
// Dock Popover Management
// ==========================================
/**
 * Toggles a target dock popover and closes all other open popovers.
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
    syncPopoverAria();
}
/**
 * Closes all open dock popovers.
 */
function closeAllPopovers() {
    const allPopovers = document.querySelectorAll('.dock-popover');
    allPopovers.forEach(popover => popover.classList.add('hidden'));
    syncPopoverAria();
}
function syncPopoverAria() {
    const infoPanelEl = document.getElementById('info-panel');
    const micPopoverEl = document.getElementById('mic-popover');
    const cameraPopoverEl = document.getElementById('camera-popover');
    const settingsPopoverEl = document.getElementById('settings-popover');
    const infoBtnEl = document.getElementById('info-btn');
    const micArrowBtnEl = document.getElementById('mic-arrow-btn');
    const camArrowBtnEl = document.getElementById('cam-arrow-btn');
    const settingsBtnEl = document.getElementById('settings-btn');
    if (infoBtnEl && infoPanelEl)
        infoBtnEl.setAttribute('aria-expanded', String(!infoPanelEl.classList.contains('hidden')));
    if (micArrowBtnEl && micPopoverEl)
        micArrowBtnEl.setAttribute('aria-expanded', String(!micPopoverEl.classList.contains('hidden')));
    if (camArrowBtnEl && cameraPopoverEl)
        camArrowBtnEl.setAttribute('aria-expanded', String(!cameraPopoverEl.classList.contains('hidden')));
    if (settingsBtnEl && settingsPopoverEl)
        settingsBtnEl.setAttribute('aria-expanded', String(!settingsPopoverEl.classList.contains('hidden')));
}
// ==========================================
// Device Selection & Hardware Enumeration (Zoom/Meet Style)
// ==========================================
/**
 * Enumerates connected media devices and populates microphone and camera selection dropdowns & popovers.
 */
async function populateDeviceLists() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
        return;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(d => d.kind === 'audioinput');
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        const currentAudioDeviceId = localStream && localStream.getAudioTracks().length > 0 ?
            localStream.getAudioTracks()[0].getSettings().deviceId : null;
        const currentVideoDeviceId = localStream && localStream.getVideoTracks().length > 0 ?
            localStream.getVideoTracks()[0].getSettings().deviceId : null;
        if (micSelect) {
            micSelect.innerHTML = '';
            audioDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microphone ${index + 1}`;
                micSelect.appendChild(option);
            });
            if (currentAudioDeviceId)
                micSelect.value = currentAudioDeviceId;
        }
        const micDeviceList = document.getElementById('mic-device-list');
        if (micDeviceList) {
            micDeviceList.innerHTML = '';
            audioDevices.forEach((device, index) => {
                const item = document.createElement('div');
                const isCurrent = currentAudioDeviceId === device.deviceId;
                item.className = `device-item ${isCurrent ? 'active' : ''}`;
                const labelSpan = document.createElement('span');
                labelSpan.textContent = device.label || `Microphone ${index + 1}`;
                item.appendChild(labelSpan);
                if (isCurrent) {
                    const checkSpan = document.createElement('span');
                    checkSpan.textContent = '✓';
                    item.appendChild(checkSpan);
                }
                item.addEventListener('click', () => {
                    switchMicrophone(device.deviceId);
                    if (micSelect)
                        micSelect.value = device.deviceId;
                    closeAllPopovers();
                });
                micDeviceList.appendChild(item);
            });
        }
        if (cameraSelect) {
            cameraSelect.innerHTML = '';
            videoDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Camera ${index + 1}`;
                cameraSelect.appendChild(option);
            });
            if (currentVideoDeviceId)
                cameraSelect.value = currentVideoDeviceId;
        }
        const camDeviceList = document.getElementById('cam-device-list');
        if (camDeviceList) {
            camDeviceList.innerHTML = '';
            videoDevices.forEach((device, index) => {
                const item = document.createElement('div');
                const isCurrent = currentVideoDeviceId === device.deviceId;
                item.className = `device-item ${isCurrent ? 'active' : ''}`;
                const labelSpan = document.createElement('span');
                labelSpan.textContent = device.label || `Camera ${index + 1}`;
                item.appendChild(labelSpan);
                if (isCurrent) {
                    const checkSpan = document.createElement('span');
                    checkSpan.textContent = '✓';
                    item.appendChild(checkSpan);
                }
                item.addEventListener('click', () => {
                    switchCamera(device.deviceId);
                    if (cameraSelect)
                        cameraSelect.value = device.deviceId;
                    closeAllPopovers();
                });
                camDeviceList.appendChild(item);
            });
        }
    }
    catch (err) {
        console.error('Error enumerating hardware devices:', err);
    }
}
/**
 * Dynamically switches active microphone hardware input without tearing down the WebRTC connection.
 */
async function switchMicrophone(deviceId) {
    if (!deviceId)
        return;
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: deviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        const newAudioTrack = newStream.getAudioTracks()[0];
        if (localStream) {
            const oldAudioTrack = localStream.getAudioTracks()[0];
            if (oldAudioTrack) {
                oldAudioTrack.stop();
                localStream.removeTrack(oldAudioTrack);
            }
            localStream.addTrack(newAudioTrack);
        }
        setupAutoTalkAudioEngine(newStream);
        if (currentCall && currentCall.peerConnection) {
            const senders = currentCall.peerConnection.getSenders();
            const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
            if (audioSender) {
                await audioSender.replaceTrack(newAudioTrack);
                console.log('RTCRtpSender audio track hot-swapped smoothly.');
            }
        }
        showToast('Microphone switched successfully', 'success');
        await populateDeviceLists();
    }
    catch (err) {
        console.error('Error switching microphone:', err);
        showToast('Failed to switch microphone.', 'error');
    }
}
/**
 * Dynamically switches active camera hardware input without tearing down the WebRTC connection.
 */
async function switchCamera(deviceId) {
    if (!deviceId)
        return;
    try {
        const preset = QUALITY_PRESETS[currentQuality];
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: { exact: deviceId },
                aspectRatio: { ideal: 1.41421356 },
                width: { ideal: preset.width },
                height: { ideal: preset.height },
                frameRate: { ideal: preset.frameRate }
            }
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (localStream) {
            const oldVideoTrack = localStream.getVideoTracks()[0];
            if (oldVideoTrack) {
                oldVideoTrack.stop();
                localStream.removeTrack(oldVideoTrack);
            }
            localStream.addTrack(newVideoTrack);
        }
        if (localVideo)
            localVideo.srcObject = localStream;
        if (currentCall && currentCall.peerConnection) {
            const senders = currentCall.peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(newVideoTrack);
                console.log('RTCRtpSender video track hot-swapped smoothly.');
            }
        }
        showToast('Camera switched successfully', 'success');
        await populateDeviceLists();
    }
    catch (err) {
        console.error('Error switching camera:', err);
        showToast('Failed to switch camera.', 'error');
    }
}
/**
 * Sets up global DOM event listeners for buttons, popovers, and device toggles.
 */
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
            allPopovers.forEach(pop => { if (pop !== infoPanel)
                pop.classList.add('hidden'); });
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
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target.closest('.dock-popover') && !target.closest('.floating-dock')) {
            closeAllPopovers();
        }
    });
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
    if (copyIdBtn) {
        copyIdBtn.addEventListener('click', () => {
            const idText = myIdDisplay.textContent;
            if (idText && idText !== 'Generating ID...') {
                copyToClipboard(idText);
            }
        });
    }
    if (remoteIdInput) {
        remoteIdInput.addEventListener('input', () => {
            const raw = remoteIdInput.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
            const chunks = raw.match(/.{1,4}/g);
            remoteIdInput.value = chunks ? chunks.join('-') : raw;
        });
    }
    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            const remoteId = remoteIdInput.value.trim();
            if (!remoteId) {
                showToast('Please enter a valid Darpan Number.', 'error');
                return;
            }
            const clean = cleanDarpanId(remoteId);
            if (localDarpanId && (clean === localDarpanId || remoteId === ('darpan-' + localDarpanId))) {
                alert('You cannot call your own Darpan Number!');
                return;
            }
            initiateCall(remoteId);
        });
    }
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', () => {
            hangUpCall('Call Ended');
        });
    }
    if (btnQualityHigh)
        btnQualityHigh.addEventListener('click', () => setMediaQuality('high'));
    if (btnQualityMedium)
        btnQualityMedium.addEventListener('click', () => setMediaQuality('medium'));
    if (btnQualityLow)
        btnQualityLow.addEventListener('click', () => setMediaQuality('low'));
    const popoverQualityHigh = document.getElementById('popover-quality-high');
    const popoverQualityMedium = document.getElementById('popover-quality-medium');
    const popoverQualityLow = document.getElementById('popover-quality-low');
    if (popoverQualityHigh)
        popoverQualityHigh.addEventListener('click', () => { setMediaQuality('high'); updatePopoverQualityButtons('high'); });
    if (popoverQualityMedium)
        popoverQualityMedium.addEventListener('click', () => { setMediaQuality('medium'); updatePopoverQualityButtons('medium'); });
    if (popoverQualityLow)
        popoverQualityLow.addEventListener('click', () => { setMediaQuality('low'); updatePopoverQualityButtons('low'); });
    if (toggleMicBtn) {
        toggleMicBtn.addEventListener('click', handleMicrophoneToggle);
    }
    if (toggleCamBtn) {
        toggleCamBtn.addEventListener('click', handleCameraToggle);
    }
    if (micSelect) {
        micSelect.addEventListener('change', (e) => {
            const target = e.target;
            switchMicrophone(target.value);
        });
    }
    if (cameraSelect) {
        cameraSelect.addEventListener('change', (e) => {
            const target = e.target;
            switchCamera(target.value);
        });
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
        toggleMicBtn.setAttribute('aria-pressed', 'true');
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
    }
    else {
        toggleMicBtn.classList.remove('inactive');
        toggleMicBtn.setAttribute('aria-pressed', 'false');
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
        if (localCamAvatar)
            localCamAvatar.classList.remove('hidden');
        toggleCamBtn.classList.add('inactive');
        toggleCamBtn.setAttribute('aria-pressed', 'true');
        toggleCamBtn.innerHTML = `
            <svg class="btn-icon cam-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
            Cam Off
        `;
        showToast('Camera Disabled', 'warning');
    }
    else {
        if (localCamAvatar)
            localCamAvatar.classList.add('hidden');
        toggleCamBtn.classList.remove('inactive');
        toggleCamBtn.setAttribute('aria-pressed', 'false');
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
 */
function initiateCall(remoteId) {
    if (!localStream) {
        showToast('Local stream is not ready. Please grant camera and microphone access.', 'error');
        return;
    }
    const clean = cleanDarpanId(remoteId);
    if (localDarpanId && (clean === localDarpanId || remoteId === ('darpan-' + localDarpanId))) {
        alert('You cannot call your own Darpan Number!');
        return;
    }
    const targetSignalingId = clean.length >= 1 ? ('darpan-' + clean) : (remoteId.startsWith('darpan-') ? remoteId : ('darpan-' + remoteId));
    remotePeerId = targetSignalingId;
    isIntentionalDisconnect = false;
    // Ephemeral session nonce for this 1-on-1 call
    activeEphemeralSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2) + Date.now().toString(36);
    updateStatus('Connecting...', 'warning');
    console.log(`Initiating outgoing call to: ${targetSignalingId} (Session: ${activeEphemeralSessionId})`);
    try {
        if (peer) {
            const conn = peer.connect(targetSignalingId);
            setupDataConnection(conn);
        }
    }
    catch (e) {
        console.warn("Failed to create DataConnection side-channel:", e);
    }
    try {
        if (!peer)
            throw new Error("PeerJS is not initialized.");
        const call = peer.call(targetSignalingId, localStream, {
            metadata: {
                sessionId: activeEphemeralSessionId,
                callerId: localDarpanId
            }
        });
        if (!call)
            throw new Error("PeerJS failed to create the call object.");
        setupCallEvents(call);
    }
    catch (e) {
        console.error("Failed to initiate call:", e);
        showToast("Error initiating call. Ensure the remote ID is online.", "error");
        updateStatus("Call Failed", "disconnected");
    }
}
/**
 * Handles an incoming WebRTC call from a remote peer.
 */
function handleIncomingCall(call) {
    // Strict 2-Person Exclusivity: If a call is already active, reject incoming caller immediately
    if (currentCall !== null && currentCall.open) {
        console.warn('Rejecting third-party incoming call from:', call.peer);
        try {
            call.close();
        }
        catch (e) { }
        const callerClean = cleanDarpanId(call.peer);
        showToast(`Call from ${formatDarpanId(callerClean)} rejected (Session busy)`, 'warning');
        return;
    }
    try {
        remotePeerId = call.peer;
        const callerId = cleanDarpanId(call.peer);
        if (remoteIdInput)
            remoteIdInput.value = formatDarpanId(callerId);
        // Ephemeral session binding
        if (call.metadata && call.metadata.sessionId) {
            activeEphemeralSessionId = call.metadata.sessionId;
        }
        else {
            activeEphemeralSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : Math.random().toString(36).substring(2);
        }
        showToast(`Incoming call from: ${formatDarpanId(callerId)}`, 'info');
        isIntentionalDisconnect = false;
        if (localStream)
            call.answer(localStream);
        setupCallEvents(call);
    }
    catch (e) {
        console.error("Failed to answer incoming call:", e);
        showToast("Error answering call.", "error");
    }
}
/**
 * Binds lifecycle event listeners to an active PeerJS MediaConnection.
 */
function setupCallEvents(call) {
    currentCall = call;
    if (call.peerConnection) {
        enforcePreferredCodecs(call.peerConnection);
        call.peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                attachRemoteStream(event.streams[0]);
            }
        };
    }
    if (connectBtn)
        connectBtn.style.display = 'none';
    if (disconnectBtn)
        disconnectBtn.style.display = 'inline-flex';
    updateCallUIState(true);
    call.on('stream', (stream) => {
        attachRemoteStream(stream);
    });
    call.on('close', () => {
        console.log('Call close event received from remote user.');
        if (!isIntentionalDisconnect) {
            isIntentionalDisconnect = true;
            resetCallUI('Remote user disconnected');
        }
    });
    call.on('error', (err) => {
        console.error('Call error:', err);
        resetCallUI('Call Error');
    });
    if (call.peerConnection) {
        monitorIceConnectionState(call.peerConnection);
    }
}
/**
 * Attaches a remote MediaStream to the remote video element and initializes post-processing.
 */
function attachRemoteStream(stream) {
    if (!stream)
        return;
    console.log('Attaching remote MediaStream to video element.');
    if (remoteVideo) {
        remoteVideo.srcObject = stream;
        remoteVideo.play().catch(e => console.warn('Remote video playback auto-handled:', e));
    }
    setupRemoteAudioAnalysis(stream);
    const upscaleCanvas = document.getElementById('upscale-canvas');
    if (upscaleCanvas && remoteVideo) {
        initUpscaler(remoteVideo, upscaleCanvas);
    }
    if (remoteVideoPlaceholder) {
        remoteVideoPlaceholder.style.opacity = '0';
        setTimeout(() => { remoteVideoPlaceholder.style.display = 'none'; }, 400);
    }
    updateStatus('Connected', 'connected');
    setMediaQuality(currentQuality);
}
function monitorIceConnectionState(peerConnection) {
    peerConnection.oniceconnectionstatechange = () => {
        const iceState = peerConnection.iceConnectionState;
        console.log(`WebRTC ICE Connection State: ${iceState}`);
        if (iceState === 'disconnected' || iceState === 'failed' || iceState === 'closed') {
            if (isIntentionalDisconnect) {
                console.log('Connection closed intentionally. Resetting UI...');
                resetCallUI('Remote user disconnected');
                return;
            }
            updateStatus('Reconnecting...', 'warning');
            if (reconnectTimeoutId)
                clearTimeout(reconnectTimeoutId);
            reconnectTimeoutId = setTimeout(() => {
                if (!isIntentionalDisconnect && remotePeerId && (!currentCall || !currentCall.open)) {
                    console.log(`Attempting auto-reconnect call to remote ID: ${remotePeerId}`);
                    initiateCall(remotePeerId);
                }
            }, 3000);
        }
        else if (iceState === 'connected' || iceState === 'completed') {
            if (reconnectTimeoutId)
                clearTimeout(reconnectTimeoutId);
            updateStatus('Connected', 'connected');
            startTelemetry();
        }
    };
}
function hangUpCall(statusText = 'Call Ended') {
    isIntentionalDisconnect = true;
    if (dataConnection && dataConnection.open) {
        try {
            dataConnection.send({ type: 'end-call' });
        }
        catch (e) {
            console.warn('Error broadcasting end-call signal:', e);
        }
    }
    if (currentCall) {
        try {
            currentCall.close();
        }
        catch (e) { }
    }
    if (dataConnection) {
        try {
            dataConnection.close();
        }
        catch (e) { }
        dataConnection = null;
    }
    stopTelemetry();
    resetCallUI(statusText);
}
function resetCallUI(statusMessage) {
    currentCall = null;
    activeEphemeralSessionId = null;
    if (reconnectTimeoutId)
        clearTimeout(reconnectTimeoutId);
    stopUpscaler();
    const localTile = document.getElementById('local-video-tile');
    const remoteContainer = document.getElementById('video-container');
    if (localTile)
        localTile.classList.remove('speaking-aura');
    if (remoteContainer)
        remoteContainer.classList.remove('speaking-aura');
    remoteAnalyserNode = null;
    if (remoteVideo)
        remoteVideo.srcObject = null;
    if (remoteVideoPlaceholder) {
        remoteVideoPlaceholder.style.display = 'flex';
        setTimeout(() => { remoteVideoPlaceholder.style.opacity = '1'; }, 50);
    }
    if (connectBtn)
        connectBtn.style.display = 'inline-flex';
    if (disconnectBtn)
        disconnectBtn.style.display = 'none';
    updateCallUIState(false);
    stopTelemetry();
    updateStatus(statusMessage || 'Awaiting Connection', statusMessage === 'Connected' ? 'connected' : 'warning');
}
/**
 * Updates the floating panel & dock layout depending on call state (lobby vs in-call).
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
        if (panelTitle)
            panelTitle.textContent = 'Call Info';
        if (callInfoSection)
            callInfoSection.classList.remove('hidden');
        preCallSections.forEach(el => el.classList.add('hidden'));
        if (dockQualityGroup)
            dockQualityGroup.classList.add('hidden');
        if (dockEndCallGroup)
            dockEndCallGroup.classList.remove('hidden');
        if (dockInCallTools)
            dockInCallTools.classList.remove('hidden');
        if (callParticipant) {
            const clean = cleanDarpanId(remotePeerId);
            const idToDisplay = clean.length >= 1 ? formatDarpanId(clean) : (remotePeerId ? (remotePeerId.substring(0, 12) + '...') : 'Remote Peer');
            callParticipant.textContent = idToDisplay;
        }
        startCallTimer();
    }
    else {
        if (panelTitle)
            panelTitle.textContent = 'Connection Details';
        if (callInfoSection)
            callInfoSection.classList.add('hidden');
        preCallSections.forEach(el => el.classList.remove('hidden'));
        if (dockQualityGroup)
            dockQualityGroup.classList.remove('hidden');
        if (dockEndCallGroup)
            dockEndCallGroup.classList.add('hidden');
        if (dockInCallTools)
            dockInCallTools.classList.add('hidden');
        stopCallTimer();
    }
}
/**
 * Starts the live duration timer for active calls.
 */
function startCallTimer() {
    stopCallTimer();
    callStartTime = Date.now();
    const durationEl = document.getElementById('call-duration');
    if (!durationEl)
        return;
    callTimerInterval = setInterval(() => {
        if (!callStartTime)
            return;
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
    if (durationEl)
        durationEl.textContent = '00:00';
}
// ==========================================
// Telemetry (Bandwidth Monitoring)
// ==========================================
function startTelemetry() {
    if (telemetryIntervalId)
        clearInterval(telemetryIntervalId);
    lastBytesSent = 0;
    lastBytesReceived = 0;
    lastTimestamp = performance.now();
    telemetryIntervalId = setInterval(async () => {
        if (!currentCall || !currentCall.peerConnection)
            return;
        try {
            const stats = await currentCall.peerConnection.getStats(null);
            let bytesSent = 0;
            let bytesReceived = 0;
            stats.forEach((report) => {
                if (report.type === 'outbound-rtp' && report.bytesSent)
                    bytesSent += report.bytesSent;
                if (report.type === 'inbound-rtp' && report.bytesReceived)
                    bytesReceived += report.bytesReceived;
            });
            const now = performance.now();
            const timeDelta = (now - lastTimestamp) / 1000;
            if (timeDelta > 0) {
                const uploadBps = ((bytesSent - lastBytesSent) * 8) / timeDelta;
                const downloadBps = ((bytesReceived - lastBytesReceived) * 8) / timeDelta;
                if (statUpload)
                    statUpload.textContent = (uploadBps / 1000000).toFixed(2) + ' Mbps';
                if (statDownload)
                    statDownload.textContent = (downloadBps / 1000000).toFixed(2) + ' Mbps';
            }
            lastBytesSent = bytesSent;
            lastBytesReceived = bytesReceived;
            lastTimestamp = now;
        }
        catch (e) {
            console.error('Stats polling error', e);
        }
    }, 1000);
}
function stopTelemetry() {
    if (telemetryIntervalId) {
        clearInterval(telemetryIntervalId);
        telemetryIntervalId = null;
    }
    if (statUpload)
        statUpload.textContent = '0.00 Mbps';
    if (statDownload)
        statDownload.textContent = '0.00 Mbps';
}
// ==========================================
// Quality Constraints & Bandwidth Manipulation
// ==========================================
function setMediaQuality(qualityLevel) {
    if (!QUALITY_PRESETS[qualityLevel])
        return Promise.resolve();
    qualityChangeQueue = qualityChangeQueue.then(async () => {
        try {
            await executeQualityChange(qualityLevel);
        }
        catch (err) {
            console.error('Error applying setMediaQuality:', err);
        }
    });
    return qualityChangeQueue;
}
async function executeQualityChange(qualityLevel) {
    currentQuality = qualityLevel;
    const preset = QUALITY_PRESETS[qualityLevel];
    if (btnQualityHigh)
        btnQualityHigh.classList.remove('active');
    if (btnQualityMedium)
        btnQualityMedium.classList.remove('active');
    if (btnQualityLow)
        btnQualityLow.classList.remove('active');
    if (qualityLevel === 'high' && btnQualityHigh)
        btnQualityHigh.classList.add('active');
    else if (qualityLevel === 'medium' && btnQualityMedium)
        btnQualityMedium.classList.add('active');
    else if (qualityLevel === 'low' && btnQualityLow)
        btnQualityLow.classList.add('active');
    updatePopoverQualityButtons(qualityLevel);
    if (localStream && localStream.getVideoTracks().length > 0) {
        const videoTrack = localStream.getVideoTracks()[0];
        try {
            await videoTrack.applyConstraints({
                aspectRatio: { ideal: 1.41421356 },
                width: { ideal: preset.width },
                height: { ideal: preset.height },
                frameRate: { ideal: preset.frameRate }
            });
            console.log(`Local video track constraints applied: ${preset.width}x${preset.height} @ ${preset.frameRate}fps (sqrt(2):1 optimal ratio)`);
        }
        catch (err) {
            console.warn('Could not apply video track hardware constraints:', err);
        }
    }
    if (currentCall && currentCall.peerConnection) {
        const senders = currentCall.peerConnection.getSenders();
        for (const sender of senders) {
            if (!sender.track)
                continue;
            if (sender.track.kind === 'video') {
                try {
                    const parameters = sender.getParameters();
                    if (!parameters.encodings || parameters.encodings.length === 0) {
                        parameters.encodings = [{}];
                    }
                    parameters.encodings[0].maxBitrate = preset.videoMaxBitrate;
                    await sender.setParameters(parameters);
                    console.log(`Video RTCRtpSender maxBitrate updated: ${preset.videoMaxBitrate} bps`);
                }
                catch (err) {
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
                }
                catch (err) {
                    console.error('Error in audio RTCRtpSender setParameters:', err);
                }
            }
        }
    }
    setMonochromeMode(true);
    showToast(`Quality set to ${qualityLevel.charAt(0).toUpperCase() + qualityLevel.slice(1)} (1080p ${preset.frameRate === 60 ? '60fps Native HFR' : '30fps -> 60fps Extrapolated'})`, 'info');
}
// ==========================================
// Codec Enforcement (Strict AV1 / VP9 Only & Opus)
// ==========================================
function enforcePreferredCodecs(peerConnection) {
    if (!peerConnection || typeof RTCRtpReceiver === 'undefined' || !('getCapabilities' in RTCRtpReceiver)) {
        return;
    }
    try {
        const videoCapabilities = RTCRtpReceiver.getCapabilities('video');
        let sortedVideoCodecs = null;
        if (videoCapabilities && videoCapabilities.codecs) {
            const preferredVideo = [];
            videoCapabilities.codecs.forEach(codec => {
                const mimeType = codec.mimeType.toLowerCase();
                // STRICTLY AV1 AND VP9 ONLY - NOTHING ELSE (NO H.264, NO VP8)
                if (mimeType.includes('video/av1'))
                    preferredVideo.push(codec);
                else if (mimeType.includes('video/vp9'))
                    preferredVideo.push(codec);
            });
            if (preferredVideo.length > 0) {
                sortedVideoCodecs = preferredVideo;
            }
        }
        const audioCapabilities = RTCRtpReceiver.getCapabilities('audio');
        let sortedAudioCodecs = null;
        if (audioCapabilities && audioCapabilities.codecs) {
            const preferredAudio = [];
            audioCapabilities.codecs.forEach(codec => {
                const mimeType = codec.mimeType.toLowerCase();
                if (mimeType.includes('audio/opus')) {
                    preferredAudio.push(codec);
                }
            });
            if (preferredAudio.length > 0) {
                sortedAudioCodecs = preferredAudio;
            }
        }
        const transceivers = peerConnection.getTransceivers();
        transceivers.forEach(transceiver => {
            if (!transceiver.receiver || !transceiver.receiver.track)
                return;
            if (transceiver.receiver.track.kind === 'video' && sortedVideoCodecs && typeof transceiver.setCodecPreferences === 'function') {
                transceiver.setCodecPreferences(sortedVideoCodecs);
                console.log(`Video Codec Preferences Enforced. Top preferred: ${sortedVideoCodecs[0].mimeType}`);
            }
            if (transceiver.receiver.track.kind === 'audio' && sortedAudioCodecs && typeof transceiver.setCodecPreferences === 'function') {
                transceiver.setCodecPreferences(sortedAudioCodecs);
                console.log(`Audio Codec Preferences Enforced. Top preferred: ${sortedAudioCodecs[0].mimeType}`);
            }
        });
    }
    catch (e) {
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
        if (state === 'connected')
            statusBadge.classList.add('connected');
        if (state === 'disconnected')
            statusBadge.classList.add('disconnected');
    }
}
function showToast(message, type = 'info') {
    if (!toastContainer)
        return;
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
    }
    else {
        fallbackCopy(text);
    }
}
function fallbackCopy(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        showToast('Peer ID copied to clipboard!', 'success');
    }
    catch (err) {
        showToast('Failed to copy Peer ID', 'error');
    }
    document.body.removeChild(textArea);
}
function updatePopoverQualityButtons(qualityLevel) {
    const popoverQualityHigh = document.getElementById('popover-quality-high');
    const popoverQualityMedium = document.getElementById('popover-quality-medium');
    const popoverQualityLow = document.getElementById('popover-quality-low');
    if (popoverQualityHigh)
        popoverQualityHigh.classList.remove('active');
    if (popoverQualityMedium)
        popoverQualityMedium.classList.remove('active');
    if (popoverQualityLow)
        popoverQualityLow.classList.remove('active');
    if (qualityLevel === 'high' && popoverQualityHigh)
        popoverQualityHigh.classList.add('active');
    if (qualityLevel === 'medium' && popoverQualityMedium)
        popoverQualityMedium.classList.add('active');
    if (qualityLevel === 'low' && popoverQualityLow)
        popoverQualityLow.classList.add('active');
}
// ==========================================
// Clean Page Reload & Unload Resource Cleanup
// ==========================================
window.addEventListener('beforeunload', cleanupResources);
window.addEventListener('pagehide', cleanupResources);
function cleanupResources() {
    stopUpscaler();
    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                track.stop();
            }
            catch (e) { }
        });
    }
    if (currentCall) {
        try {
            currentCall.close();
        }
        catch (e) { }
    }
    if (peer) {
        try {
            peer.destroy();
        }
        catch (e) { }
    }
}
//# sourceMappingURL=app.js.map