# Sit Well

**A live posture coach that tells you what to fix — not just that something's wrong.**

🔗 **Live demo:** https://tharanikadari.github.io/sit-well/

Most posture-alarm tools just beep when you slouch, leaving you to guess what's actually wrong. Sit Well uses your webcam and a pose-detection model to track your eyes and shoulders in real time, and tells you exactly what to correct — "sit up straight," "move back to center" — with a soft chime and a spoken hint, not a harsh siren.

## Features

- **Live pose tracking** — follows your eyes and shoulders through your webcam using TensorFlow.js and PoseNet, entirely in-browser
- **Smart calibration** — takes a short reading of your normal sitting position as your personal target, instead of a generic ideal
- **Specific guidance** — tells you *what* is wrong (slouching vs. leaning), not just that something is
- **Voice guidance** — optionally speaks corrections out loud, using the browser's built-in text-to-speech
- **Session history graph** — a live chart showing how your posture trended through the session
- **Privacy-first** — no video, image, or data ever leaves your browser; nothing is recorded, uploaded, or stored

## Tech stack

| Layer | Tool |
|---|---|
| Pose detection | [TensorFlow.js](https://www.tensorflow.org/js) / PoseNet (via [ml5.js](https://ml5js.org/)) |
| Rendering / camera loop | [p5.js](https://p5js.org/) |
| Audio | Web Audio API (generated chime) & Web Speech API (voice guidance) |
| UI | Vanilla HTML/CSS/JS — no build step, no framework |

## How it works

1. **Get ready** — Sit Well averages your position over about a second after you click Start. That becomes your personal baseline.
2. **Track** — every frame, it measures how far your eyes and shoulders have moved from that baseline, smoothed to filter out natural camera jitter.
3. **Guide** — if you drift too far for too long, it tells you specifically what to fix, with a gentle chime and (optionally) a spoken hint — then stops automatically once you correct it.

## Running locally

No build tools or installs required:

```bash
git clone https://github.com/TharaniKadari/sit-well.git
cd sit-well
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

(A local server is needed because browsers block webcam access on `file://` pages.)

## Project background

This project began as a group assignment exploring pose-detection APIs. This version is an independent rebuild: new scoring logic with multi-frame calibration and score smoothing, a redesigned interface, corrective (not just alarm-based) guidance, voice feedback, and a from-scratch visual identity.

## License

MIT — see [LICENSE](LICENSE).
