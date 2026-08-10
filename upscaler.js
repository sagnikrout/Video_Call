/**
 * WebGL Spatial Interpolation (Contrast Adaptive Sharpening)
 * Upscales and sharpens incoming WebRTC video streams in real-time.
 */

let upscalerAnimationFrameId = null;

/**
 * Initializes the WebGL spatial interpolation upscaler.
 * Intercepts the HTML5 <video> stream, applies a 3x3 Convolution Matrix 
 * (Laplacian edge enhancement), and outputs to the provided <canvas>.
 * 
 * @param {HTMLVideoElement} videoElement - The source WebRTC video stream.
 * @param {HTMLCanvasElement} canvasElement - The destination canvas for the shader.
 */
function initUpscaler(videoElement, canvasElement) {
    if (!videoElement || !canvasElement) return;

    // Stop any existing render loop before re-initializing
    if (upscalerAnimationFrameId) {
        cancelAnimationFrame(upscalerAnimationFrameId);
        upscalerAnimationFrameId = null;
    }

    try {
        const gl = canvasElement.getContext('webgl2') || canvasElement.getContext('webgl');
        if (!gl) {
            console.warn("WebGL not supported, falling back to standard video rendering.");
            canvasElement.style.display = 'none';
            videoElement.style.display = 'block';
            return;
        }

        // Vertex Shader: Renders a simple full-screen quad
        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y); // Flip Y to match WebGL vs HTML orientation
            }
        `;

        // Fragment Shader: Advanced Post-Processing with Aspect-Ratio Matching (3x3 Laplacian Sharpening, Contrast, Gamma)
        const fsSource = `
            precision mediump float;
            uniform sampler2D u_image;
            uniform vec2 u_resolution;
            uniform vec2 u_scale;
            varying vec2 v_texCoord;

            const float gamma = 1.05;
            const float contrast = 1.15;

            void main() {
                // Scale UV coordinates relative to texture center to preserve original video aspect ratio (object-fit: cover)
                vec2 uv = (v_texCoord - 0.5) * u_scale + 0.5;

                // Letterbox clamp check: render clean black if outside video frame
                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }

                vec2 texelSize = 1.0 / u_resolution;

                // Sample surrounding pixels for 3x3 convolution matrix
                vec4 center = texture2D(u_image, uv);
                vec4 top    = texture2D(u_image, uv + vec2(0.0, -texelSize.y));
                vec4 bottom = texture2D(u_image, uv + vec2(0.0, texelSize.y));
                vec4 left   = texture2D(u_image, uv + vec2(-texelSize.x, 0.0));
                vec4 right  = texture2D(u_image, uv + vec2(texelSize.x, 0.0));
                vec4 tl     = texture2D(u_image, uv + vec2(-texelSize.x, -texelSize.y));
                vec4 tr     = texture2D(u_image, uv + vec2(texelSize.x, -texelSize.y));
                vec4 bl     = texture2D(u_image, uv + vec2(-texelSize.x, texelSize.y));
                vec4 br     = texture2D(u_image, uv + vec2(texelSize.x, texelSize.y));

                // Laplacian edge enhancement (Unsharp Masking)
                float sharpness = 1.0; 
                vec4 edge = center * 8.0 - (top + bottom + left + right + tl + tr + bl + br);
                vec4 color = center + (edge * sharpness * 0.15);

                // Contrast enhancement curve
                color.rgb = (color.rgb - 0.5) * contrast + 0.5;

                // Gamma correction for color vibrancy
                color.rgb = pow(abs(color.rgb), vec3(1.0 / gamma));

                gl_FragColor = clamp(color, 0.0, 1.0);
                gl_FragColor.a = 1.0;
            }
        `;

        /**
         * Compiles a WebGL shader from source string.
         */
        function compileShader(gl, type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

        const shaderProgram = gl.createProgram();
        gl.attachShader(shaderProgram, vertexShader);
        gl.attachShader(shaderProgram, fragmentShader);
        gl.linkProgram(shaderProgram);

        if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            throw new Error("Unable to initialize the shader program: " + gl.getProgramInfoLog(shaderProgram));
        }

        gl.useProgram(shaderProgram);

        // Set up buffers (Quad)
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = [
            -1.0,  1.0,
             1.0,  1.0,
            -1.0, -1.0,
             1.0, -1.0,
        ];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        const texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        const texCoords = [
            0.0,  0.0,
            1.0,  0.0,
            0.0,  1.0,
            1.0,  1.0,
        ];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

        // Bind Attributes
        const positionLocation = gl.getAttribLocation(shaderProgram, "a_position");
        gl.enableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        const texCoordLocation = gl.getAttribLocation(shaderProgram, "a_texCoord");
        gl.enableVertexAttribArray(texCoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        // Create Texture
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        const resolutionLocation = gl.getUniformLocation(shaderProgram, "u_resolution");
        const scaleLocation = gl.getUniformLocation(shaderProgram, "u_scale");

        /**
         * Main WebGL render loop synchronized with browser frames.
         */
        function renderLoop() {
            if (!videoElement.paused && !videoElement.ended && videoElement.videoWidth > 0) {
                const displayWidth = canvasElement.clientWidth * (window.devicePixelRatio || 1);
                const displayHeight = canvasElement.clientHeight * (window.devicePixelRatio || 1);
                
                if (canvasElement.width !== displayWidth || canvasElement.height !== displayHeight) {
                    canvasElement.width = displayWidth;
                    canvasElement.height = displayHeight;
                    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
                }

                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);

                gl.uniform2f(resolutionLocation, videoElement.videoWidth, videoElement.videoHeight);

                // Calculate Aspect Ratio Scale (object-fit: cover equivalent)
                const canvasAspect = displayWidth / displayHeight;
                const videoAspect = videoElement.videoWidth / videoElement.videoHeight;
                
                let scaleX = 1.0;
                let scaleY = 1.0;

                if (videoAspect > canvasAspect) {
                    scaleX = canvasAspect / videoAspect;
                } else {
                    scaleY = videoAspect / canvasAspect;
                }

                gl.uniform2f(scaleLocation, scaleX, scaleY);

                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            upscalerAnimationFrameId = requestAnimationFrame(renderLoop);
        }

        // Start loop once video has enough data
        videoElement.addEventListener('play', () => {
            renderLoop();
        });
        
        // In case it's already playing
        if (!videoElement.paused) {
            renderLoop();
        }
    } catch (e) {
        console.error('WebGL Rendering Engine Failed:', e);
        // Graceful fallback to HTML5 video element
        canvasElement.style.display = 'none';
        videoElement.style.display = 'block';
    }
}

window.initUpscaler = initUpscaler;
