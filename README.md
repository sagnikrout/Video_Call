# P2P WebRTC Video Call Application

A client-side Peer-to-Peer video calling web application built with HTML5, CSS3, Vanilla JavaScript, WebRTC, and PeerJS.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![WebRTC](https://img.shields.io/badge/WebRTC-Enabled-brightgreen.svg)
![PeerJS](https://img.shields.io/badge/PeerJS-Cloud--Signaling-orange.svg)

---

## 🌟 Key Features

- **Peer-to-Peer Video & Audio**: Direct end-to-end encrypted media transmission using WebRTC (DTLS/SRTP).
- **Zero Backend Required**: Runs strictly client-side on GitHub Pages using PeerJS cloud signaling.
- **Dynamic Quality & Bitrate Controls**: Real-time resolution and bandwidth adjustments (High 1080p @ 4.0 Mbps, Medium 720p @ 1.5 Mbps, Low 480p @ 500 kbps) using `RTCRtpSender.setParameters()`.
- **Responsive Layout**: Full-bleed remote video viewport with floating Picture-in-Picture local camera overlay.
- **Auto Reconnection & Recovery**:
  - ICE connection state monitoring (`disconnected`/`failed`) with 2-second auto-reconnection timeout.
  - Automatic signaling server reconnection via `peer.reconnect()`.
- **Included QA & Stress Test Suite**:
  - `debug.js`: Live DOM validation, media constraint interceptor, and `getStats()` bitrate monitoring loop.
  - `stress.js`: Automated rapid quality toggling (100x), network drop simulation, tab backgrounding checks, and permission denial loops.

---

## 📁 Repository Structure

```text
.
├── index.html       # HTML5 structure with HTTPS CDNs & exact DOM IDs
├── style.css        # Responsive dark CSS theme & active button styles
├── app.js           # Core WebRTC, PeerJS & RTCRtpSender logic
├── debug.js         # Diagnostic & getStats() bitrate monitoring harness
└── stress.js        # Automated client-side stress testing harness
```

---

## 🚀 How to Run Locally

1. Clone or download this repository.
2. Open `index.html` in any modern web browser (Chrome, Firefox, Edge, Safari).
3. Grant camera and microphone permissions when prompted.
4. Share your Peer ID with a friend, enter their Peer ID, and click **Call**.

---

## 🌐 Live GitHub Pages Deployment

The application is deployed on GitHub Pages at:
`https://sagnikrout.github.io/Video_Call/`

---

## 📜 License

This project is open-source and available under the [MIT License](LICENSE).
