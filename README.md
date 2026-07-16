# Voice Portal 🎙️

> Speak in any language — AI replies in the **same language and tone**.

Live at **[voice.14.jugaar.ai](https://voice.14.jugaar.ai)**

## Features

- 🎤 **Multilingual STT** — Urdu, English, Arabic, Hindi, and 90+ languages
- 🗣️ **Same-language replies** — AI responds in the language you spoke
- ⚡ **Streaming transcription** — words appear live as you speak
- 🔊 **Text-to-Speech** — 400+ voices via Edge TTS
- 📊 **Analytics dashboard** — latency, language breakdown, interaction traces
- 👍👎 **Feedback system** — rate responses to improve quality
- 🔒 **Anonymous** — no login required, no PII collected

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | Next.js (App Router) + Tailwind CSS |
| Backend | Python FastAPI + WebSocket |
| STT (Streaming) | faster-whisper `tiny` (CPU, real-time preview) |
| STT (Final) | faster-whisper `medium` (CPU, full accuracy) |
| TTS | Edge TTS (free, 400+ voices) |
| LLM | Groq/Llama-3 (with smart fallback) |
| Database | SQLite |
| Deploy | Nginx + PM2 + Let's Encrypt SSL |

## How Streaming Transcription Works

1. User speaks → audio chunks stream to server every 1s via WebSocket
2. Backend runs lightweight STT (`tiny` model) every ~2.5s for live preview
3. Frontend shows interim transcript in real-time (teal "Live transcription" indicator)
4. On stop → full audio sent → accurate STT (`medium` model) → finalized transcript
5. LLM generates reply → Edge TTS plays it back

## Setup

### Prerequisites
- Python 3.12+
- Node.js 18+
- ffmpeg
- ~2GB RAM for STT models

### Backend

```bash
cd backend
python -m venv ../venv
source ../venv/bin/activate
pip install -r ../requirements.txt

# Optional: add Groq API key for intelligent replies
echo "GROQ_API_KEY=your_key_here" > ../.env

# Start
uvicorn main:app --host 0.0.0.0 --port 8005
```

### Frontend

```bash
cd frontend
npm install
npm run dev  # dev on port 3005
npm run build && npm start  # production
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | _(empty)_ | Groq API key for LLM responses |
| `HF_API_TOKEN` | _(empty)_ | HuggingFace token (optional, free tier works) |
| `DB_PATH` | `voice_portal.db` | SQLite database path |
| `WHISPER_MODEL_PATH` | `models/whisper` | Path to local Whisper model |
| `BACKEND_PORT` | `8005` | Backend port |

## Deployment (PM2)

```bash
pm2 start backend/main.py --name voice-portal-api --interpreter python3
cd frontend && pm2 start npm --name voice-portal-ui -- start
```

## License

MIT
