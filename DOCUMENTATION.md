# 🎙️ Voice Portal — Complete Documentation

> **Speak in any language, get real-time transcription + voice playback.**
> 
> Live: **[voice.14.jugaar.ai](https://voice.14.jugaar.ai)**

---

## 📌 What Is Voice Portal?

Voice Portal is a web application that lets users:
1. **Speak** into their microphone
2. **See** real-time transcription (words appear as they speak)
3. **Hear** the transcription spoken back in the same language

No login required. No paid APIs. Fully anonymous.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  FRONTEND                        │
│              Next.js + Tailwind CSS              │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ Speak →  │  │ Text →   │  │  Analytics    │ │
│  │ Text     │  │ Voice    │  │  Dashboard    │ │
│  └────┬─────┘  └────┬─────┘  └───────────────┘ │
│       │              │                           │
└───────┼──────────────┼───────────────────────────┘
        │              │
   WebSocket       REST API
        │              │
┌───────┼──────────────┼───────────────────────────┐
│       │              │                           │
│  ┌────▼──────────────▼────┐                     │
│  │     BACKEND API         │                     │
│  │   FastAPI + WebSocket   │                     │
│  └────┬──────────────┬────┘                     │
│       │              │                           │
│  ┌────▼────┐    ┌────▼────┐                     │
│  │ STT     │    │ TTS     │                     │
│  │faster-  │    │Edge TTS │                     │
│  │whisper  │    │(Microsoft)│                    │
│  └─────────┘    └─────────┘                     │
│                                                  │
│  ┌─────────────────────┐                        │
│  │ SQLite Database     │                        │
│  │ (analytics + logs)  │                        │
│  └─────────────────────┘                        │
└──────────────────────────────────────────────────┘
        │
   ┌────▼────┐
   │  VPS    │
   │ (CPU)   │
   └─────────┘
```

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 16.2.10 | React framework (App Router) |
| **TypeScript** | - | Type safety |
| **Tailwind CSS** | - | Styling |
| **WebSocket** | - | Real-time streaming communication |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| **Python** | 3.12+ | Backend language |
| **FastAPI** | - | Web framework |
| **WebSocket** | - | Real-time audio streaming |
| **SQLite** | - | Database for analytics |
| **Uvicorn** | - | ASGI server |
| **PM2** | - | Process manager |

### AI Models (All Free / Local)
| Model | Type | Size | Purpose |
|-------|------|------|---------|
| **faster-whisper `medium`** | STT | ~1.5GB | Final transcription (accurate) |
| **faster-whisper `tiny`** | STT | ~75MB | Streaming preview (fast) |
| **Edge TTS** | TTS | Cloud (free) | Text-to-Speech (400+ voices) |

### No Paid APIs Used
- ❌ No OpenAI API
- ❌ No Google Cloud
- ❌ No Azure Speech
- ❌ No Groq
- ❌ No HuggingFace API tokens
- ✅ **Zero cost forever**

---

## 🎯 Features

### 1. Speech-to-Text (STT)
- **Engine:** faster-whisper (OpenAI Whisper implementation for CPU)
- **Model:** `medium` (final) + `tiny` (streaming preview)
- **Languages:** 99 languages including Urdu, English, Hindi, Arabic, French, Spanish, German, Turkish, Chinese, Japanese, Korean, Russian, and more
- **Auto-detection:** Whisper automatically detects the spoken language
- **Manual override:** Users can select specific language from dropdown
- **Urdu Note:** Auto-detect picks Hindi for Urdu speakers. Select "Urdu" from dropdown for accurate Urdu transcription.

### 2. Streaming Transcription
- **How it works:**
  1. Audio chunks stream to server every 1 second via WebSocket
  2. Backend runs lightweight STT (`tiny` model) every ~2.5 seconds
  3. Frontend displays interim transcript in real-time (teal "Live transcription" indicator)
  4. When user stops → full audio sent → accurate STT (`medium` model) → finalized transcript
- **Visual:** Teal pulsing dot + italic text while streaming, white bold text when finalized

### 3. Text-to-Speech (TTS)
- **Engine:** Edge TTS (Microsoft's free neural TTS service)
- **Voices:** 400+ voices across 17+ languages
- **Mapped Voices:**
  | Language | Voice |
  |----------|-------|
  | English | en-US-GuyNeural |
  | Urdu | ur-PK-AsadNeural |
  | Hindi | hi-IN-MadhurNeural |
  | Arabic | ar-SA-HamedNeural |
  | French | fr-FR-HenriNeural |
  | Spanish | es-ES-AlvaroNeural |
  | German | de-DE-ConradNeural |
  | Turkish | tr-TR-AhmetNeural |
  | Russian | ru-RU-DmitryNeural |
  | Chinese | zh-CN-YunxiNeural |
  | Japanese | ja-JP-KeitaNeural |
  | Korean | ko-KR-InJoonNeural |
  | Portuguese | pt-BR-AntonioNeural |
  | Italian | it-IT-DiegoNeural |
  | Dutch | nl-NL-MaartenNeural |
  | Polish | pl-PL-MarekNeural |
  | Czech | cs-CZ-AntoninNeural |

### 4. Text-to-Voice (Manual)
- Users can type text and hear it spoken in any language
- Select language → type text → click Play

### 5. Analytics Dashboard
- **URL:** `/analytics`
- **Metrics:**
  - Total interactions
  - Language breakdown
  - Average latency (STT, TTS, Total)
  - Interaction traces (per-session)
  - Error logs
- **Database:** SQLite with `interactions` and `sessions` tables

### 6. Feedback System
- 👍/👎 rating on each interaction
- Optional feedback text
- Stored in database for improvement

### 7. Anonymous Usage
- No login required
- Session ID generated per browser tab
- No PII collected
- All data stored locally on VPS

---

## 📊 Database Schema

### interactions Table
```sql
CREATE TABLE interactions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    engine TEXT NOT NULL,           -- "local"
    transcript TEXT,                -- What user said
    detected_language TEXT,         -- "ur", "en", "hi", etc.
    reply_text TEXT,                -- What was spoken back
    stt_latency_ms REAL,           -- STT processing time
    llm_latency_ms REAL,           -- Always 0 (no LLM)
    tts_latency_ms REAL,           -- TTS processing time
    total_latency_ms REAL,         -- Total round-trip time
    status TEXT DEFAULT 'success', -- "success" or "error"
    error_message TEXT,
    feedback INTEGER,              -- 1 (up) or -1 (down)
    feedback_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### sessions Table
```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔌 API Endpoints

### REST API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check + engine status |
| GET | `/api/languages` | List available TTS voices |
| GET | `/api/analytics` | Dashboard metrics |
| GET | `/api/trace/{id}` | Full trace of one interaction |
| GET | `/api/history` | Interaction history (filterable) |
| GET | `/api/sessions/{id}/stats` | Per-session statistics |
| POST | `/api/feedback/{id}` | Submit feedback |

### WebSocket
| Endpoint | Description |
|----------|-------------|
| `/ws/{session_id}` | Real-time voice interaction |

**WebSocket Message Types:**

| Direction | Type | Description |
|-----------|------|-------------|
| Client → Server | `start_streaming` | Initialize streaming (with language override) |
| Client → Server | `chunk` | Audio chunk (every 1s during recording) |
| Client → Server | `stop_streaming` | Signal end of streaming |
| Client → Server | `audio` | Final complete audio for full STT |
| Client → Server | `text` | Text-to-TTS mode |
| Server → Client | `status` | Stage update (transcribing/speaking/error) |
| Server → Client | `interim_transcript` | Partial STT result (streaming) |
| Server → Client | `transcript` | Final STT result |
| Server → Client | `audio_reply` | TTS audio (base64 MP3) |
| Server → Client | `interaction_complete` | Processing done |

---

## ⚡ Performance

| Metric | Value |
|--------|-------|
| STT (final) | ~25-38 seconds (medium model on 2-core CPU) |
| STT (streaming) | ~2-3 seconds (tiny model) |
| TTS | ~1-2 seconds |
| Total round-trip | ~27-40 seconds |
| Model load time (medium) | ~30 seconds (first request) |
| Model load time (tiny) | ~1 second |
| Memory usage (API) | ~2GB (with models loaded) |

**Note:** Performance is limited by 2-core CPU. Would be instant on GPU or larger CPU.

---

## 🚀 Deployment

### Server Requirements
- **OS:** Ubuntu (any recent version)
- **CPU:** 2+ cores
- **RAM:** 4GB+ (2GB for models)
- **Disk:** 10GB+ (models + code)
- **Network:** Public IP or domain

### Services (PM2)
```bash
pm2 status
# voice-portal-api   → Backend (port 8005)
# voice-portal-ui    → Frontend (port 3005)
```

### Nginx Config (Reverse Proxy)
```
https://voice.14.jugaar.ai → localhost:3005 (frontend)
                          → localhost:8005/ws (WebSocket)
```

### SSL
- Let's Encrypt (free)
- Auto-renewal via certbot

---

## 📁 Project Structure

```
voice-portal/
├── backend/
│   └── main.py              # FastAPI backend (all-in-one)
├── frontend/
│   ├── app/
│   │   ├── page.tsx          # Main voice portal UI
│   │   ├── analytics/
│   │   │   └── page.tsx      # Analytics dashboard
│   │   ├── api/
│   │   │   └── languages/
│   │   │       └── route.ts  # API proxy for languages
│   │   ├── layout.tsx        # Root layout
│   │   └── globals.css       # Tailwind styles
│   ├── next.config.ts        # Next.js config
│   ├── tailwind.config.ts    # Tailwind config
│   └── package.json          # Frontend dependencies
├── requirements.txt          # Python dependencies
├── .env                      # Environment variables
├── voice_portal.db           # SQLite database
└── README.md                 # Project readme
```

---

## 🔧 Setup Instructions

### Prerequisites
```bash
# System packages
sudo apt update
sudo apt install python3.12 python3-pip nodejs npm ffmpeg

# Python venv
python3 -m venv venv
source venv/bin/activate
```

### Backend
```bash
cd backend
pip install -r ../requirements.txt

# Start
uvicorn main:app --host 0.0.0.0 --port 8005
```

### Frontend
```bash
cd frontend
npm install

# Development
npm run dev        # Port 3005

# Production
npm run build
npm start          # Port 3005
```

### PM2 (Production)
```bash
pm2 start backend/main.py --name voice-portal-api --interpreter python3
cd frontend && pm2 start npm --name voice-portal-ui -- start
pm2 save
pm2 startup        # Auto-start on boot
```

---

## 🐛 Known Issues & Limitations

1. **Urdu vs Hindi:** Whisper auto-detect picks Hindi for Urdu speakers. Workaround: Select "Urdu" from language dropdown.
2. **Slow STT:** Medium model takes ~25-38s on 2-core CPU. Would be instant with GPU.
3. **No AI Replies:** System only transcribes and echoes back. No conversational AI.
4. **Single Session:** Each browser tab gets its own session. No multi-user collaboration.
5. **No Persistent History:** Analytics only show current server data. No export/backup.

---

## 📝 Changelog

### v1.0 (Current)
- ✅ STT with faster-whisper (medium model)
- ✅ TTS with Edge TTS (400+ voices)
- ✅ Real-time streaming transcription
- ✅ Language auto-detection + manual override
- ✅ Analytics dashboard
- ✅ Feedback system
- ✅ Anonymous usage
- ✅ WebSocket real-time communication
- ✅ SQLite database for logs

---

## 📄 License

MIT License

---

## 👥 Credits

- **faster-whisper** — CTranslate2 implementation of OpenAI Whisper
- **Edge TTS** — Microsoft's free neural text-to-speech
- **FastAPI** — Modern Python web framework
- **Next.js** — React framework for production
- **Tailwind CSS** — Utility-first CSS framework

---

*Last updated: July 16, 2026*
