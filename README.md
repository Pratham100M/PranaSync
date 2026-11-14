# 🌿 PranaSync — Botanical Yoga, Meditation & Circadian Wellness Sanctuary

![Python](https://img.shields.io/badge/Python-3.11%2B-059669?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-047857?style=flat-square&logo=fastapi&logoColor=white)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Pose%2033--Point-10B981?style=flat-square)
![Web Audio](https://img.shields.io/badge/Web%20Audio-Offline%20Soundscapes-D97706?style=flat-square)
![Privacy](https://img.shields.io/badge/Storage-100%25%20Local%20%26%20Private-065F46?style=flat-square)

**PranaSync** is a privacy-first, offline-capable web application that unites real-time AI posture coaching, procedural Web Audio meditation soundscapes, personalized yoga and walking plans, and longitudinal mental wellness tracking inside a circadian-adaptive botanical interface.

---

## ✨ Key Features

### 1. 📹 Live Webcam MediaPipe Pose & 8-Asana Studio
* **33-Landmark Full-Body Tracking:** Runs client-side via MediaPipe Pose with Exponential Moving Average (EMA) smoothing and adjustable posture angle tolerance (`±5°` to `±25°`).
* **Real-Time Biomechanical Scoring (0–100):** Evaluates bilateral knee, hip, shoulder, and elbow joint angles alongside center-of-mass sway index, left/right symmetry, and continuous aligned-hold streak timers (`≥75 pts`).
* **Rate-Limited Voice & Visual Coaching:** Delivers prioritized corrective cues every `3.5s` via the Web Speech API without audio overlap, paired with an offline **Demo Pose Preview** mode for camera-free testing.
* **Voice-Synchronized 4-Step Pose Walkthrough:** Grounded anatomical keyframe animations rendered on HTML5 Canvas that automatically wait for spoken instructions to finish before advancing.

### 2. 🪷 Meditate & Pranayama Sanctuary
* **Interactive Breathing Lotus Visualizer:** Guides pacing across **Coherent (`5-5s`)**, **Box Focus (`4-4-4-4s`)**, **Deep Calm (`4-7-8s`)**, and **Silent Focus** modes.
* **100% Offline Procedural Web Audio:** Synthesizes **Monsoon Rain**, **Ocean Surf**, **Forest Breeze & Chimes**, a **432Hz Tanpura Drone**, and a harmonic **Tibetan Singing Bowl** directly in the browser with zero external audio files.

### 3. 🎯 Goals, Sequenced Yoga Plan Runner & Walk Planner
* **Tailored Prescriptions:** Combines 5 wellness goals (*Calmer Mind*, *Weight Loss*, *Stamina*, *Flexibility*, *Strength & Balance*) with 3 session depths (*Quick 10m*, *Balanced 20m*, *Deep 30m*).
* **Camera-Integrated Plan Runner:** Automatically sequences poses, hold countdowns, rest intervals, and voice transitions inside the Pose Studio.

### 4. 🏆 Gamification, Challenges & Botanical Badges
* **XP, Levels & Streaks:** Earn XP across holds, guided plans, meditation, walks, journaling, and check-ins to progress from *Novice Yogi* to *Zen Sage*.
* **8 Collectible Sanctuary Seals:** Auto-tracks milestones (*Lotus Sprout*, *Bhujanga Seal*, *Tadasana Pillar*, *Surya Sequencer*, *Dhyana Lotus*, *Prithvi Walker*, *Smriti Scribe*, and *Prana Sovereign*).

### 5. 📓 Daily Journal, Check-Ins & Mental Wellness Screeners
* **Private Reflection Journal & Check-Ins:** Tracks daily gratitude entries alongside 1–5 mood, perceived stress, and sleep quality sliders.
* **PHQ-9 & GAD-7 Self-Reflection Screeners:** Includes severity scoring and a dynamic **Tele-MANAS (`14416` / `1-800-891-4416`)** 24/7 confidential mental health helpline banner if PHQ-9 Item 9 indicates distress.

### 6. 📈 Insights & Adaptive Circadian Themes
* **14-Day Longitudinal Analytics:** Dual-axis Chart.js visualization correlating daily active practice minutes with self-reported mood and stress trends.
* **Circadian Palette Engine:** Automatically adapts (or switches manually) between **Morning Dew & Marigold**, **Midday Canopy & Jade**, and **Twilight Canopy & Indigo Lotus** dark mode.
* **Optional Local Progress Vault:** Password-protected SHA-256 salted `localStorage` profiles with one-click `.json` backup export and restore.

---

## 🧘 Supported Sanskrit Asanas

| Sanskrit Name | English Name | Primary Biomechanical Focus |
| :--- | :--- | :--- |
| **Tadasana (ताडासन)** | Mountain Pose | Axial posture & grounding |
| **Vrikshasana (वृक्षासन)** | Tree Pose | Single-leg balance & focus |
| **Virabhadrasana II (वीरभद्रासन II)** | Warrior II Pose | Lower-body stamina & alignment |
| **Trikonasana (त्रिकोणासन)** | Extended Triangle Pose | Lateral spine & hamstring mobility |
| **Adho Mukha Svanasana (अधोमुखश्वानासन)** | Downward-Facing Dog | Full-body spinal decompression |
| **Utkatasana (उत्कटासन)** | Chair Pose | Metabolic burn & core endurance |
| **Bhujangasana (भुजंगासन)** | Cobra Pose | Thoracic opening & posterior chain |
| **Anjaneyasana (अञ्जनेयासन)** | Low Crescent Lunge | Hip-flexor release & pelvic stability |

---

## 📁 Project Structure

```text
PranaSync/
├── main.py                        # FastAPI server & Jinja2 entrypoint
├── requirements.txt               # Python backend dependencies
├── .gitignore                     # Excludes .venv and Python cache files
├── README.md                      # Project documentation
├── templates/
│   └── index.html                 # Multi-module semantic HTML layout
└── static/
    ├── css/
    │   └── styles.css             # Circadian theme tokens & glassmorphism styles
    └── js/
        ├── tailwind-config.js     # Botanical color palette & typography config
        └── app.js                 # MediaPipe pose engine, Web Audio & state logic
```

---

## 🚀 Getting Started

### Prerequisites
* **Python 3.11+**
* Modern desktop or mobile browser (Chrome, Edge, Firefox, or Safari)

### Installation & Local Run

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/Pratham100M/PranaSync.git](https://github.com/Pratham100M/PranaSync.git)
   cd PranaSync
   ```

2. **Create and activate a virtual environment:**
   ```powershell
   # Windows PowerShell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
   ```bash
   # macOS / Linux
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   python -m pip install -r requirements.txt
   ```

4. **Start the FastAPI server:**
   ```bash
   python -m uvicorn main:app --reload --port 8000
   ```

5. Open **http://127.0.0.1:8000** in your browser.

---

## 🔒 Privacy & Wellness Disclaimer

* **100% On-Device Processing:** All webcam pose inference, journal entries, screener responses, and account vaults stay strictly in your browser (`localStorage`). No video frames or personal logs are transmitted to external servers.
* **Non-Diagnostic Notice:** PranaSync is a self-reflection and mindful movement companion, not a substitute for professional medical or psychiatric care. For free, confidential 24/7 mental health support in India, call **Tele-MANAS at `14416`**.

---

## 👤 Author

**Arya Pratham S** — [@Pratham100M](https://github.com/Pratham100M)
