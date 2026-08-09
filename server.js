// ============================================================
// Lio Backend — Hybrid-System (ElevenLabs Turbo + Replicate)
// ============================================================
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import 'dotenv/config';
import Replicate from 'replicate';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ── Cache-Ordner anlegen & freigeben ──
const CACHE_DIR = path.join(__dirname, 'audio_cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}
app.use('/cache', express.static(CACHE_DIR));

// ── API Key Checks ──
if (!process.env.GROQ_API_KEY) console.error('❌ GROQ_API_KEY fehlt!');
if (!process.env.ELEVENLABS_API_KEY) console.warn('⚠️ ELEVENLABS_API_KEY fehlt!');
if (!process.env.REPLICATE_API_TOKEN) console.warn('⚠️ REPLICATE_API_TOKEN fehlt!');

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || '',
});

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(__dirname));

// ── HYBRID TTS ENGINE (Prüft Cache -> ElevenLabs Turbo -> Replicate) ──
async function generateTTS(text, mode = 'talk') {
  const cleanText = text.trim();
  
  // 1. Eindeutigen Hash für den Satz erzeugen (zentral für Caching)
  const hash = crypto
    .createHash('sha256')
    .update(cleanText)
    .digest('hex');
  
  const cacheMp3 = path.join(CACHE_DIR, `${hash}.mp3`);
  const cacheWav = path.join(CACHE_DIR, `${hash}.wav`);

  // 2. STUFE 1: CACHE-PRÜFUNG (0 € Kosten, instant Reaktionszeit)
  if (fs.existsSync(cacheMp3)) return `/cache/${hash}.mp3`;
  if (fs.existsSync(cacheWav)) return `/cache/${hash}.wav`;

  // 3. ENTSCHEIDUNG: Wann ElevenLabs und wann Replicate?
  // - Längere Texte (>120 Zeichen) ODER Geschichten-Modus -> Replicate (Gemini TTS)
  // - Kurze Dialoge (<120 Zeichen) -> ElevenLabs (Hohe Qualität, 50% günstiger durch Turbo)
  const isLongText = cleanText.length > 120 || mode === 'stories';

  if (!isLongText && process.env.ELEVENLABS_API_KEY) {
    try {
      console.log(`🎙️ ElevenLabs Turbo: "${cleanText.substring(0, 30)}..."`);
      
      // TRAGE HIER DIE ID VON "MANNI" EIN:
      const voiceId = 'jBpfuIE2acCO8z3wKNLl'; 
      
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: cleanText,
          // AGENT-OPTIMIERUNG: Turbo-Modell spart 50% der Kosten und ist schneller beim Streaming!
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });

      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(cacheMp3, buffer);
        return `/cache/${hash}.mp3`;
      }
      console.warn('ElevenLabs Limit/Fehler -> Fallback auf Replicate');
    } catch (e) {
      console.error('ElevenLabs Fehler:', e.message);
    }
  }

  // 4. STUFE 3: REPLICATE (Für Geschichten & lange Erklärungen & Fallback)
  try {
    console.log(`🤖 Replicate Gemini (Langtext/Fallback): "${cleanText.substring(0, 30)}..."`);
    const output = await replicate.run("google/gemini-3.1-flash-tts", {
      input: {
        text: cleanText,
        voice: "Puck",
        prompt: "",
        language_code: "de-DE"
      }
    });

    const audioUrl = output.url ? output.url() : output;
    const audioRes = await fetch(audioUrl);
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    
    fs.writeFileSync(cacheWav, buffer);
    return `/cache/${hash}.wav`;

  } catch (err) {
    console.error('Replicate TTS Fehler:', err.message);
    throw new Error('Kein TTS-Anbieter erreichbar');
  }
}

// ── API: Chat-Stream (Wasserhahn mit Hybrid-Routing) ──
app.post('/api/chat-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { messages, childName, mode, mood, activeTopic, topicResolved, subject } = req.body;
    
    const nameStr = childName ? `Das Kind heißt ${childName}. ` : '';
    const modeStr = mode ? `Modus: ${mode}. ` : '';

    let systemInstruction = `Du bist Lio, ein superfreundlicher Roboter-Freund. 
    WICHTIG: Du heißt Lio. Antworte in maximal 2 sehr kurzen Sätzen. Nutze einfache Wörter. ${nameStr}${modeStr}`;
    
    if (mode === 'stories') {
      systemInstruction = `Du bist Lio. Erzähle eine spannende, kurze Kindergeschichte in ca. 4-5 Sätzen. ${nameStr}`;
    } else if (mode === 'homework') {
      systemInstruction += ` DU BIST NACHHILFELEHRER. Verrate niemals direkte Ergebnisse, sondern stelle clevere, kurze Fragen.`;
    }
    
    if (subject) systemInstruction += ` Fach: ${subject}.`;
    if (activeTopic) systemInstruction += ` Thema: ${activeTopic}. Verstanden? ${topicResolved ? 'Ja' : 'Nein'}.`;

    const formattedMessages = [
      { role: 'system', content: systemInstruction },
      ...messages.map(msg => ({ role: msg.role, content: msg.content }))
    ];

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: formattedMessages,
        temperature: 0.7,
        stream: true
      })
    });

    const reader = groqResponse.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let currentSentence = "";
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          const data = JSON.parse(line.slice(6));
          const token = data.choices[0].delta.content || "";
          currentSentence += token;
          
          if (/[.!?]\s*$/.test(currentSentence)) {
            const cleanSentence = currentSentence.trim();
            if (cleanSentence.length > 2) {
              // Hybrid-TTS aufrufen (entscheidet automatisch ob ElevenLabs oder Replicate!)
              const audioUrl = await generateTTS(cleanSentence, mode);
              res.write(`data: ${JSON.stringify({ text: cleanSentence, audio: audioUrl })}\n\n`);
            }
            currentSentence = ""; 
          }
        }
      }
    }
    
    if (currentSentence.trim().length > 0) {
      const audioUrl = await generateTTS(currentSentence.trim(), mode);
      res.write(`data: ${JSON.stringify({ text: currentSentence.trim(), audio: audioUrl })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Streaming Fehler:', error);
    res.write(`data: {"error": "Lio ist kurz eingeschlafen!"}\n\n`);
    res.end();
  }
});

// ── KOMPATIBILITÄTS-ROUTEN ──
app.post('/api/chat', async (req, res) => {
  res.json({ reply: "Nutze bitte den neuen Chat-Stream!" });
});

app.post('/api/speak', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Kein Text.' });
  try {
    const url = await generateTTS(text);
    const cachePath = path.join(__dirname, url);
    if (fs.existsSync(cachePath)) {
      const buffer = fs.readFileSync(cachePath);
      const ext = path.extname(cachePath);
      res.set({ 'Content-Type': ext === '.mp3' ? 'audio/mpeg' : 'audio/wav', 'Content-Length': buffer.length });
      return res.send(buffer);
    }
  } catch(e) {
    console.error(e);
  }
  res.status(500).json({ error: 'Fehler' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Lio Hybrid-Server läuft auf Port ${PORT}!`);
});
