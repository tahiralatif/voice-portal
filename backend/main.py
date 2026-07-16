"""
Voice Portal - Backend
FastAPI + WebSocket for real-time voice interaction.
"""

import os
import uuid
import time
import json
import sqlite3
import asyncio
import io
import wave
import tempfile
import base64
import traceback
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import numpy as np

load_dotenv()

# === Config ===
DB_PATH = os.getenv("DB_PATH", "/root/voice-portal/voice_portal.db")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
HF_API_TOKEN = os.getenv("HF_API_TOKEN", "")  # Optional - free tier works without
WHISPER_MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", "/root/voice-portal/models/whisper")

# === App ===
app = FastAPI(title="Voice Portal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket timeout settings
WS_PING_INTERVAL = 30  # seconds
WS_PING_TIMEOUT = 30   # seconds

# === Database ===
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS interactions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            engine TEXT NOT NULL,
            transcript TEXT,
            detected_language TEXT,
            reply_text TEXT,
            stt_latency_ms REAL,
            llm_latency_ms REAL,
            tts_latency_ms REAL,
            total_latency_ms REAL,
            status TEXT DEFAULT 'success',
            error_message TEXT,
            feedback INTEGER,
            feedback_text TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()

init_db()

# === STT Engine (faster-whisper, CPU) ===
stt_model = None

def load_stt():
    global stt_model
    if stt_model is None:
        from faster_whisper import WhisperModel
        print("[STT] Loading faster-whisper medium (CPU, int8) - Urdu + multilingual support...")
        stt_model = WhisperModel("medium", device="cpu", compute_type="int8")
        print("[STT] Model loaded.")

async def transcribe_local(audio_bytes: bytes, language_override: str = None) -> dict:
    """Run STT in a thread to avoid blocking the event loop."""
    load_stt()

    def _do_stt():
        # Write input audio (webm/opus from browser) to temp file
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp_in:
            tmp_in.write(audio_bytes)
            tmp_in_path = tmp_in.name

        tmp_wav_path = tmp_in_path.replace(".webm", ".wav")
        try:
            # Convert to 16kHz mono WAV for Whisper
            import subprocess
            subprocess.run(
                ["ffmpeg", "-i", tmp_in_path, "-ar", "16000", "-ac", "1", "-f", "wav", tmp_wav_path, "-y", "-loglevel", "error"],
                check=True, timeout=10
            )

            # Urdu-aware prompt helps Whisper distinguish Urdu vs Hindi
            prompt_map = {
                "ur": "یہ ایک آواز کا نظام ہے۔ صارف آپ سے اردو میں بات کر رہا ہے۔",
                "ar": "هذا نظام صوت. المستخدم يتحدث معك بالعربية.",
                "hi": "यह एक आवाज़ प्रणाली है। उपयोगकर्ता हिंदी में बात कर रहा है।",
                "tr": "Bu bir ses sistemidir. Kullanıcı sizinle Türkçe konuşuyor.",
                "fr": "Ceci est un système vocal. L'utilisateur vous parle en français.",
                "es": "Este es un sistema de voz. El usuario habla en español.",
                "de": "Dies ist ein Sprachsystem. Der Benutzer spricht mit Ihnen auf Deutsch.",
                "zh": "这是一个语音系统。用户正在用中文和你说话。",
                "ja": "これは音声システムです。ユーザーは日本語で話しています。",
                "ko": "이것은 음성 시스템입니다. 사용자가 한국어로 이야기하고 있습니다.",
                "ru": "Это голосовая система. Пользователь говорит с вами по-русски.",
                "en": "This is a voice assistant. The user is speaking to you in English.",
            }
            forced_lang = language_override if language_override and language_override != "auto" else None
            stt_prompt = prompt_map.get(forced_lang or "en", prompt_map["en"])

            segments, info = stt_model.transcribe(
                tmp_wav_path,
                beam_size=5,
                language=forced_lang,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
                initial_prompt=stt_prompt,
            )
            transcript = " ".join([seg.text for seg in segments])
            return {
                "transcript": transcript.strip(),
                "language": forced_lang or info.language,
                "language_probability": info.language_probability
            }
        finally:
            for p in [tmp_in_path, tmp_wav_path]:
                if os.path.exists(p):
                    os.unlink(p)

    return await asyncio.to_thread(_do_stt)

# === Streaming STT State ===
# Per-session audio accumulation for streaming transcription
streaming_sessions: dict[str, dict] = {}  # { session_id: { "chunks": [bytes], "last_stt": float, "interim": str } }
STREAMING_INTERVAL = 2.5  # seconds between partial STT runs
MIN_CHUNKS_FOR_STT = 3    # need at least a few chunks before running STT

# Lightweight model for streaming preview — fast on CPU
streaming_stt_model = None

def load_streaming_stt():
    global streaming_stt_model
    if streaming_stt_model is None:
        from faster_whisper import WhisperModel
        print("[STT-STREAM] Loading faster-whisper tiny (CPU, int8) — fast preview...")
        streaming_stt_model = WhisperModel("tiny", device="cpu", compute_type="int8")
        print("[STT-STREAM] Model loaded.")

STT_PROMPTS = {
    "ur": "یہ ایک آواز کا نظام ہے۔ صارف آپ سے اردو میں بات کر رہا ہے۔",
    "ar": "هذا نظام صوت. المستخدم يتحدث معك بالعربية.",
    "hi": "यह एक आवाज़ प्रणाली है। उपयोगकर्ता हिंदी में बात कर रहा है।",
    "tr": "Bu bir ses sistemidir. Kullanıcı sizinle Türkçe konuşuyor.",
    "fr": "Ceci est un système vocal. L'utilisateur vous parle en français.",
    "es": "Este es un sistema de voz. El usuario habla en español.",
    "de": "Dies ist ein Sprachsystem. Der Benutzer spricht mit Ihnen auf Deutsch.",
    "en": "This is a voice assistant. The user is speaking to you in English.",
}

async def transcribe_partial(audio_bytes: bytes, language_override: str = None) -> dict:
    """Run STT on accumulated partial audio — lightweight config for speed."""
    load_streaming_stt()

    def _do():
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp_in:
            tmp_in.write(audio_bytes)
            tmp_in_path = tmp_in.name
        tmp_wav_path = tmp_in_path.replace(".webm", ".wav")
        try:
            import subprocess
            subprocess.run(
                ["ffmpeg", "-i", tmp_in_path, "-ar", "16000", "-ac", "1", "-f", "wav", tmp_wav_path, "-y", "-loglevel", "error"],
                check=True, timeout=10
            )
            forced_lang = language_override if language_override and language_override != "auto" else None
            stt_prompt = STT_PROMPTS.get(forced_lang or "en", STT_PROMPTS["en"])
            segments, info = streaming_stt_model.transcribe(
                tmp_wav_path, beam_size=1, language=forced_lang,
                vad_filter=True, vad_parameters=dict(min_silence_duration_ms=300),
                initial_prompt=stt_prompt if forced_lang else None,
            )
            transcript = " ".join([seg.text for seg in segments])
            return {"transcript": transcript.strip(), "language": forced_lang or info.language}
        finally:
            for p in [tmp_in_path, tmp_wav_path]:
                if os.path.exists(p): os.unlink(p)

    return await asyncio.to_thread(_do)


# === TTS Engine (Edge TTS — free, 400+ voices) ===
async def synthesize_edge_tts(text: str, language: str = "en") -> bytes:
    import edge_tts
    voice_map = {
        "en": "en-US-GuyNeural",
        "ur": "ur-PK-AsadNeural",
        "ar": "ar-SA-HamedNeural",
        "es": "es-ES-AlvaroNeural",
        "fr": "fr-FR-HenriNeural",
        "de": "de-DE-ConradNeural",
        "hi": "hi-IN-MadhurNeural",
        "tr": "tr-TR-AhmetNeural",
        "ru": "ru-RU-DmitryNeural",
        "zh": "zh-CN-YunxiNeural",
        "ja": "ja-JP-KeitaNeural",
        "ko": "ko-KR-InJoonNeural",
        "pt": "pt-BR-AntonioNeural",
        "it": "it-IT-DiegoNeural",
        "nl": "nl-NL-MaartenNeural",
        "pl": "pl-PL-MarekNeural",
        "cs": "cs-CZ-AntoninNeural",
    }
    voice = voice_map.get(language, "en-US-GuyNeural")
    try:
        communicate = edge_tts.Communicate(text, voice)
        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]
        if audio_data:
            return audio_data
        print(f"[TTS] Edge TTS returned empty for voice '{voice}'")
        return generate_silence_audio(24000, 2)
    except Exception as e:
        print(f"[TTS] Edge TTS error: {e}")
        return generate_silence_audio(24000, 2)

def generate_silence_audio(sample_rate: int, duration_sec: int) -> bytes:
    num_samples = sample_rate * duration_sec
    samples = np.zeros(num_samples, dtype=np.int16)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(samples.tobytes())
    return buf.getvalue()

async def mp3_to_wav(mp3_bytes: bytes) -> bytes:
    """Convert MP3 bytes to WAV bytes using soundfile (or ffmpeg fallback)."""
    try:
        import soundfile as sf
        import io
        # soundfile can read MP3 via libsndfile or we use subprocess
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_in:
            tmp_in.write(mp3_bytes)
            tmp_in_path = tmp_in.name
        tmp_out_path = tmp_in_path.replace('.mp3', '.wav')
        try:
            proc = await asyncio.create_subprocess_exec(
                'ffmpeg', '-i', tmp_in_path, '-ar', '24000', '-ac', '1', '-f', 'wav', tmp_out_path,
                '-y', '-loglevel', 'error'
            )
            await proc.wait()
            if proc.returncode == 0 and os.path.exists(tmp_out_path):
                with open(tmp_out_path, 'rb') as f:
                    return f.read()
        except FileNotFoundError:
            pass
        finally:
            for p in [tmp_in_path, tmp_out_path]:
                if os.path.exists(p): os.unlink(p)
    except Exception as e:
        print(f"[TTS] mp3_to_wav fallback: {e}")
    return mp3_bytes  # Return original if conversion fails

# === LLM Engine (Groq + HF Fallback) ===
import httpx

async def generate_reply(transcript: str, language: str) -> dict:
    # Try Groq first
    if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
        try:
            return await _generate_groq(transcript, language)
        except Exception as e:
            print(f"[LLM] Groq failed: {e}, trying HF fallback")

    # Fallback: HuggingFace Inference API (free, no key needed for small models)
    try:
        return await _generate_hf(transcript, language)
    except Exception as e:
        print(f"[LLM] HF failed: {e}, using smart fallback")

    # Last resort: smart language-aware response
    return _smart_fallback(transcript, language)


def _smart_fallback(transcript: str, language: str) -> dict:
    """Generate a meaningful reply without any API - keyword-aware."""
    import random
    lower = transcript.lower()

    # Keyword detection for smarter responses
    greetings = any(w in lower for w in ["hello", "hi", "hey", "assalam", "salaam", "namaste", "merhaba", "bonjour", "hola", "hallo"])
    question = any(w in lower for w in ["what", "how", "why", "where", "when", "who", "can you", "could you", "kya", "kaisa", "kaise", "kab", "kahan", "kyun"])
    weather = any(w in lower for w in ["weather", "mausam", "mousam", "temperature", "barish", "rain", "sunny"])
    name = any(w in lower for w in ["name", "naam", "tumhara naam"])

    templates = {
        "en": {
            "greeting": ["Hello! How can I help you today?", "Hey there! What can I do for you?", "Hi! Nice to hear from you."],
            "question": ["That's a great question! Let me think about that.", "Interesting question! I'd love to help with that.", "Good question! Here's what I know about that."],
            "weather": ["I can't check live weather right now, but you can check weather.com for accurate forecasts!", "For real-time weather, I'd recommend checking a weather app or website.", "I wish I could check the weather for you! Try weather.com for current conditions."],
            "name": ["I'm your voice assistant! I can help answer questions, have conversations, and more.", "I'm Voice Portal's AI assistant. I'm here to help!", "You can call me your voice assistant! How can I help?"],
            "default": ["I heard you! That's interesting. Tell me more.", "Thanks for sharing! What would you like to talk about?", "I understand. Is there anything specific I can help with?"],
        },
        "ur": {
            "greeting": ["Walaikum assalam! Aapki kya madad kar sakta hoon?", "Assalam o Alaikum! Bataiye kya chahte hain?", "Jee haan, bataiye kya baat hai."],
            "question": ["Ye acha sawal hai! Main soch raha hoon.", "Bohat achi sawal hai! Main aapki madad karta hoon.", "Ye ek aham sawal hai. Dekhte hain kya keh sakta hoon."],
            "weather": ["Mausam ki jaankari abhi mere paas nahi hai, lekin aap weather apps dekh sakte hain.", "Weather check karne ke liye koi weather app ya website dekhein.", "Mujhe afsos hai, mausam ki update abhi available nahi hai."],
            "name": ["Main aapka voice assistant hoon! Main sawalat ka jawab de sakta hoon.", "Main Voice Portal ka AI assistant hoon. Aapki madad ke liye hoon!", "Aap mujhe apna voice assistant keh sakte hain! Kya poochna hai?"],
            "default": ["Main ne sun liya! Ye achi baat hai. Aur bataiye.", "Shukriya! Aap kya baat karna chahte hain?", "Samajh gaya. Kya kisi cheez mein madad chahiye?"],
        },
        "ar": {
            "greeting": ["مرحبا! كيف يمكنني مساعدتك؟", "أهلاً! كيف حالك؟", "مرحبا بك! كيف أستطيع المساعدة؟"],
            "question": ["هذا سؤال جيد! دعني أفكر.", "سؤال ممتاز! سأساعدك في ذلك.", "سؤال جيد! إليك ما أعرفه."],
            "default": ["سمعت ما قلت! هذا مثير للاهتمام.", "شكراً للمشاركة! كيف يمكنني المساعدة؟", "أفهم. هل تحتاج مساعدة في شيء؟"],
        },
        "hi": {
            "greeting": ["Namaste! Aapki kya madad kar sakta hoon?", "Namaskar! Bataiye kya baat hai?", "Jee haan, bataiye kya chahte hain?"],
            "question": ["Ye acha sawal hai! Main soch raha hoon.", "Bahut badhiya sawal hai! Main aapki madad karta hoon."],
            "default": ["Main ne sun liya! Bahut achi baat hai. Aur bataiye.", "Samajh gaya. Aap kya karna chahte hain?", "Shukriya! Kya aur kuch poochna hai?"],
        },
        "tr": {
            "greeting": ["Merhaba! Size nasıl yardımcı olabilirim?", "Selam! Ne yapabilirim?"],
            "default": ["Anladım! Bu ilginç. Devam edin.", "Teşekkürler! Başka bir şey söyleyebilir misiniz?"],
        },
        "fr": {
            "greeting": ["Bonjour! Comment puis-je vous aider?", "Salut! Qu'est-ce que je peux faire pour vous?"],
            "default": ["J'ai compris! C'est intéressant. Continuez.", "Merci! Puis-je vous aider avec autre chose?"],
        },
        "es": {
            "greeting": ["¡Hola! ¿Cómo puedo ayudarte?", "¡Hola! ¿Qué puedo hacer por ti?"],
            "default": ["¡Entendido! Eso es interesante. Cuéntame más.", "¡Gracias! ¿Puedo ayudarte con algo más?"],
        },
        "de": {
            "greeting": ["Hallo! Wie kann ich Ihnen helfen?", "Hey! Was kann ich für Sie tun?"],
            "default": ["Ich habe verstanden! Das ist interessant. Erzählen Sie mehr.", "Danke! Kann ich Ihnen mit etwas anderem helfen?"],
        },
    }

    lang_templates = templates.get(language, templates["en"])
    if greetings and "greeting" in lang_templates:
        reply = random.choice(lang_templates["greeting"])
    elif question and "question" in lang_templates:
        reply = random.choice(lang_templates["question"])
    elif weather and "weather" in lang_templates:
        reply = random.choice(lang_templates["weather"])
    elif name and "name" in lang_templates:
        reply = random.choice(lang_templates["name"])
    else:
        reply = random.choice(lang_templates.get("default", [f"I heard you. Tell me more!"]))

    return {"reply": reply, "latency_ms": 0, "tokens": 0, "note": "smart_fallback"}


async def _generate_hf(transcript: str, language: str) -> dict:
    """Free HuggingFace Inference API - no token needed for rate-limited usage."""
    lang_names = {
        "en": "English", "ur": "Urdu", "ar": "Arabic", "hi": "Hindi",
        "fr": "French", "es": "Spanish", "de": "German", "tr": "Turkish",
        "ru": "Russian", "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
    }
    lang_name = lang_names.get(language, "English")

    prompt = f"""You are a helpful voice assistant. Reply in {lang_name} only. Keep it short (1-2 sentences), natural, and helpful.

User: {transcript}
Assistant:"""

    start = time.time()
    async with httpx.AsyncClient(timeout=30, verify=False) as client:
        headers = {}
        if HF_API_TOKEN:
            headers["Authorization"] = f"Bearer {HF_API_TOKEN}"

        response = await client.post(
            "https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium",
            json={"inputs": prompt, "parameters": {"max_new_tokens": 100, "temperature": 0.7, "do_sample": True}},
            headers=headers,
        )
        if response.status_code != 200:
            raise Exception(f"HF API {response.status_code}: {response.text[:200]}")

        result = response.json()
        if isinstance(result, list) and len(result) > 0:
            reply = result[0].get("generated_text", "").strip()
            # Clean up - remove the prompt echo
            if "Assistant:" in reply:
                reply = reply.split("Assistant:")[-1].strip()
            if reply.startswith("You are"):
                reply = reply.split("\n")[-1].strip()
        else:
            raise Exception(f"Unexpected HF response: {result}")

    latency_ms = (time.time() - start) * 1000
    return {"reply": reply[:200], "latency_ms": latency_ms, "tokens": 0, "note": "hf_fallback"}


async def _generate_groq(transcript: str, language: str) -> dict:
    """Groq API - fast, requires API key."""
    from groq import AsyncGroq
    client = AsyncGroq(api_key=GROQ_API_KEY)

    system_prompt = """You are a helpful voice assistant. The user is speaking to you via voice.

Rules:
1. Detect the language the user is speaking in. Reply in EXACTLY the same language.
2. Match the user's tone - casual, formal, friendly, urgent, etc.
3. Keep replies concise (1-3 sentences) since they will be spoken aloud.
4. Never mix languages unless the user does.
5. Match the formality level: informal phrasing = reply informally, formal = reply formally.
6. Be helpful and natural. This is a voice conversation, not a chatbot."""

    start = time.time()
    response = await client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": transcript}
        ],
        max_tokens=150,
        temperature=0.7,
    )
    latency_ms = (time.time() - start) * 1000
    reply = response.choices[0].message.content.strip()

    return {
        "reply": reply,
        "latency_ms": latency_ms,
        "tokens": response.usage.total_tokens if response.usage else 0
    }

# === WebSocket Manager ===
class ConnectionManager:
    def __init__(self):
        self.active: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active[session_id] = websocket

    def disconnect(self, session_id: str):
        self.active.pop(session_id, None)

    async def send(self, session_id: str, data: dict):
        ws = self.active.get(session_id)
        if ws:
            await ws.send_json(data)

manager = ConnectionManager()

# === API Endpoints ===
@app.get("/health")
async def health():
    has_groq = bool(GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here")
    return {"status": "ok", "engines": ["local", "hf"], "groq_configured": has_groq, "llm": "groq" if has_groq else "hf-fallback"}

@app.get("/api/languages")
async def get_languages():
    """Available TTS languages/voices."""
    voices = [
        {"code": "en", "name": "English", "voice": "en-US-GuyNeural"},
        {"code": "ur", "name": "Urdu", "voice": "ur-PK-AsadNeural"},
        {"code": "ar", "name": "Arabic", "voice": "ar-SA-HamedNeural"},
        {"code": "es", "name": "Spanish", "voice": "es-ES-AlvaroNeural"},
        {"code": "fr", "name": "French", "voice": "fr-FR-HenriNeural"},
        {"code": "de", "name": "German", "voice": "de-DE-ConradNeural"},
        {"code": "hi", "name": "Hindi", "voice": "hi-IN-MadhurNeural"},
        {"code": "tr", "name": "Turkish", "voice": "tr-TR-AhmetNeural"},
        {"code": "ru", "name": "Russian", "voice": "ru-RU-DmitryNeural"},
        {"code": "zh", "name": "Chinese", "voice": "zh-CN-YunxiNeural"},
        {"code": "ja", "name": "Japanese", "voice": "ja-JP-KeitaNeural"},
        {"code": "ko", "name": "Korean", "voice": "ko-KR-InJoonNeural"},
        {"code": "pt", "name": "Portuguese", "voice": "pt-BR-AntonioNeural"},
        {"code": "it", "name": "Italian", "voice": "it-IT-DiegoNeural"},
        {"code": "nl", "name": "Dutch", "voice": "nl-NL-MaartenNeural"},
        {"code": "pl", "name": "Polish", "voice": "pl-PL-MarekNeural"},
        {"code": "cs", "name": "Czech", "voice": "cs-CZ-AntoninNeural"},
    ]
    return {"voices": voices}

@app.get("/api/analytics")
async def get_analytics():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) as c FROM interactions").fetchone()["c"]
    by_engine = conn.execute(
        "SELECT engine, COUNT(*) as count, AVG(total_latency_ms) as avg_latency "
        "FROM interactions GROUP BY engine"
    ).fetchall()
    by_language = conn.execute(
        "SELECT detected_language, COUNT(*) as count "
        "FROM interactions GROUP BY detected_language ORDER BY count DESC"
    ).fetchall()
    recent_errors = conn.execute(
        "SELECT * FROM interactions WHERE status = 'error' ORDER BY created_at DESC LIMIT 20"
    ).fetchall()
    conn.close()
    return {
        "total_interactions": total,
        "by_engine": [dict(r) for r in by_engine],
        "by_language": [dict(r) for r in by_language],
        "recent_errors": [dict(r) for r in recent_errors],
    }

@app.get("/api/trace/{interaction_id}")
async def get_trace(interaction_id: str):
    """Full trace of a single interaction."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM interactions WHERE id = ?", (interaction_id,)
    ).fetchone()
    conn.close()
    if not row:
        return {"error": "not found"}
    return {"interaction": dict(row)}

@app.get("/api/history")
async def get_history(engine: str = None, language: str = None, limit: int = 100):
    conn = get_db()
    query = "SELECT * FROM interactions WHERE 1=1"
    params = []
    if engine:
        query += " AND engine = ?"
        params.append(engine)
    if language:
        query += " AND detected_language = ?"
        params.append(language)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return {"interactions": [dict(r) for r in rows]}

@app.get("/api/sessions/{session_id}/stats")
async def get_session_stats(session_id: str):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM interactions WHERE session_id = ? ORDER BY created_at DESC LIMIT 100",
        (session_id,)
    ).fetchall()
    conn.close()
    if not rows:
        return {"total": 0, "interactions": []}
    return {"total": len(rows), "interactions": [dict(r) for r in rows]}

@app.post("/api/feedback/{interaction_id}")
async def submit_feedback(interaction_id: str, feedback: int, text: str = ""):
    conn = get_db()
    conn.execute(
        "UPDATE interactions SET feedback = ?, feedback_text = ? WHERE id = ?",
        (feedback, text, interaction_id)
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}

# === WebSocket Route ===
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(websocket, session_id)
    print(f"[WS] Client connected: {session_id}")

    conn = get_db()
    conn.execute("INSERT OR IGNORE INTO sessions (id) VALUES (?)", (session_id,))
    conn.commit()
    conn.close()

    try:
        while True:
            data = await websocket.receive_json()
            print(f"[WS] Received message type: {data.get('type')}")

            if data.get("type") == "text":
                # Text-to-TTS mode: user types text, gets audio back
                try:
                    text = data.get("text", "").strip()
                    tts_lang = data.get("language", "en")
                    if not text:
                        await manager.send(session_id, {"type": "status", "stage": "error", "message": "No text provided"})
                        continue

                    await manager.send(session_id, {"type": "status", "stage": "speaking"})
                    start = time.time()
                    tts_audio = await synthesize_edge_tts(text, tts_lang)
                    tts_latency = (time.time() - start) * 1000
                    tts_b64 = base64.b64encode(tts_audio).decode("utf-8")

                    await manager.send(session_id, {
                        "type": "audio_reply",
                        "audio": tts_b64,
                        "latency_ms": tts_latency,
                        "total_latency_ms": tts_latency
                    })
                    await manager.send(session_id, {
                        "type": "interaction_complete",
                        "id": str(uuid.uuid4())[:8],
                        "total_latency_ms": tts_latency
                    })
                except Exception as e:
                    traceback.print_exc()
                    await manager.send(session_id, {"type": "status", "stage": "error", "message": str(e)})
                continue

            if data.get("type") == "start_streaming":
                # Initialize streaming state with optional language override
                streaming_sessions[session_id] = {
                    "chunks": [], "last_stt": 0, "interim": "",
                    "language_override": data.get("language"),
                }
                print(f"[WS] Streaming started for {session_id}, lang={data.get('language', 'auto')}")
                continue

            if data.get("type") == "chunk":
                # Streaming audio chunk — accumulate and run partial STT periodically
                try:
                    audio_b64 = data.get("audio")
                    if not audio_b64:
                        continue
                    audio_bytes = base64.b64decode(audio_b64)

                    state = streaming_sessions.get(session_id)
                    if state is None:
                        state = {"chunks": [], "last_stt": 0, "interim": "", "language_override": None}
                        streaming_sessions[session_id] = state
                    state["chunks"].append(audio_bytes)

                    # Run partial STT every STREAMING_INTERVAL seconds if we have enough audio
                    now = time.time()
                    if len(state["chunks"]) >= MIN_CHUNKS_FOR_STT and (now - state["last_stt"]) >= STREAMING_INTERVAL:
                        state["last_stt"] = now
                        combined = b"".join(state["chunks"])
                        try:
                            result = await transcribe_partial(combined, language_override=state.get("language_override"))
                            interim = result.get("transcript", "")
                            if interim and interim != state["interim"]:
                                state["interim"] = interim
                                await manager.send(session_id, {
                                    "type": "interim_transcript",
                                    "text": interim,
                                    "language": result.get("language", "en"),
                                })
                                print(f"[WS] Interim: '{interim[:80]}'")
                        except Exception as e:
                            print(f"[WS] Partial STT error: {e}")
                except Exception as e:
                    print(f"[WS] Chunk error: {e}")
                continue

            if data.get("type") == "stop_streaming":
                # Save language override from the original start_streaming message
                state = streaming_sessions.get(session_id)
                if state:
                    state["language_override"] = data.get("language")
                continue

            if data.get("type") != "audio":
                continue

            try:
                engine = data.get("engine", "local")
                audio_b64 = data.get("audio")
                tts_language_override = data.get("language")  # Optional override for TTS voice
                interaction_id = str(uuid.uuid4())[:8]

                audio_bytes = base64.b64decode(audio_b64)
                print(f"[WS] Audio: {len(audio_bytes)} bytes, engine={engine}")

                timings = {"start": time.time()}

                # Clean up streaming state for this session
                streaming_state = streaming_sessions.pop(session_id, None)

                # Step 1: STT
                await manager.send(session_id, {"type": "status", "stage": "transcribing"})
                stt_result = await transcribe_local(audio_bytes, language_override=tts_language_override)
                timings["stt_done"] = time.time()
                stt_latency = (timings["stt_done"] - timings["start"]) * 1000

                transcript = stt_result.get("transcript", "")
                language = stt_result.get("language", "en")
                print(f"[WS] STT: '{transcript[:80]}' ({language}) in {stt_latency:.0f}ms")

                await manager.send(session_id, {
                    "type": "transcript",
                    "text": transcript,
                    "language": language,
                    "latency_ms": stt_latency
                })

                if not transcript:
                    await manager.send(session_id, {
                        "type": "status", "stage": "error",
                        "message": "No speech detected"
                    })
                    continue

                # Step 2: TTS (speak the transcript back - no LLM)
                tts_lang = tts_language_override or language
                await manager.send(session_id, {"type": "status", "stage": "speaking"})
                tts_audio = await synthesize_edge_tts(transcript, tts_lang)
                timings["tts_done"] = time.time()
                tts_latency = (timings["tts_done"] - timings["stt_done"]) * 1000
                total_latency = (timings["tts_done"] - timings["start"]) * 1000
                print(f"[WS] TTS: {len(tts_audio)} bytes in {tts_latency:.0f}ms")

                tts_b64 = base64.b64encode(tts_audio).decode("utf-8")
                print(f"[WS] Sending audio_reply: {len(tts_b64)} chars")
                await manager.send(session_id, {
                    "type": "audio_reply",
                    "audio": tts_b64,
                    "latency_ms": tts_latency,
                    "total_latency_ms": total_latency
                })
                print(f"[WS] audio_reply sent successfully")

                # Log to database
                conn = get_db()
                conn.execute(
                    """INSERT INTO interactions
                       (id, session_id, engine, transcript, detected_language, reply_text,
                        stt_latency_ms, llm_latency_ms, tts_latency_ms, total_latency_ms, status)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')""",
                    (interaction_id, session_id, engine, transcript, language,
                     transcript, stt_latency, 0, tts_latency, total_latency)
                )
                conn.commit()
                conn.close()

                print(f"[WS] Complete: {total_latency:.0f}ms total")
                await manager.send(session_id, {
                    "type": "interaction_complete",
                    "id": interaction_id,
                    "total_latency_ms": total_latency
                })

            except Exception as e:
                traceback.print_exc()
                print(f"[WS] Processing error: {e}")
                try:
                    await manager.send(session_id, {
                        "type": "status", "stage": "error",
                        "message": str(e)
                    })
                except Exception:
                    pass

    except WebSocketDisconnect:
        print(f"[WS] Client disconnected: {session_id}")
        streaming_sessions.pop(session_id, None)
        manager.disconnect(session_id)
    except Exception as e:
        traceback.print_exc()
        print(f"[WS] Fatal error: {e}")
        streaming_sessions.pop(session_id, None)
        manager.disconnect(session_id)

# === Main ===
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("BACKEND_PORT", 8005))
    uvicorn.run(app, host="0.0.0.0", port=port, ws_ping_interval=60, ws_ping_timeout=60)
