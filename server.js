// ============================================================
// Lio Backend — Groq (Llama 3.3) & Gemini TTS (Streaming)
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

// ── Render Proxy-Fix (Behebt die X-Forwarded-For Warnung) ──
app.set('trust proxy', 1);

// ── Cache-Ordner anlegen & freigeben (WICHTIG FÜR STREAMING!) ──
const CACHE_DIR = path.join(__dirname, 'audio_cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}
// Macht den Cache-Ordner für das Frontend aufrufbar (z.B. /cache/123.wav)
app.use('/cache', express.static(CACHE_DIR));

// ── API Key Checks ─────────────────────────────────────────
if (!process.env.GROQ_API_KEY) {
  console.error('\n❌ GROQ_API_KEY fehlt!');
  process.exit(1);
}
if (!process.env.REPLICATE_API_TOKEN) {
  console.error('\n❌ REPLICATE_API_TOKEN fehlt!');
  process.exit(1);
}

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(__dirname));

// ── Hilfsfunktion: TTS Generieren & Cachen ─────────────────
async function generateTTS(text) {
  const voice = 'Puck';
  const prompt = ""; // Leer lassen für Google-Filter!
  
  const hash = crypto
    .createHash('sha256')
    .update(`${voice}_${text.trim()}`)
    .digest('hex');
  
  const filename = `${hash}.wav`;
  const cachePath = path.join(CACHE_DIR, filename);
  const publicUrl = `/cache/${filename}`; // Diese URL kriegt das Frontend

  if (fs.existsSync(cachePath)) {
    return publicUrl;
  }

  const output = await replicate.run("google/gemini-3.1-flash-tts", {
    input: { text: text, voice: voice, prompt: prompt, language_code: "de-DE" }
  });

  const audioUrl = output.url ? output.url() : output;
  const audioResponse = await fetch(audioUrl);
  const buffer = Buffer.from(await audioResponse.arrayBuffer());
  fs.writeFileSync(cachePath, buffer);

  return publicUrl;
}

// ── API: Chat-Stream (Der Wasserhahn für Weg 3!) ───────────
app.post('/api/chat-stream', async (req, res) => {
  // Wir bereiten eine Server-Sent-Events (SSE) Verbindung vor
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { messages, childName, mode, mood } = req.body;
    
    let systemInstruction = `Du bist Lio, ein superfreundlicher Roboter-Freund. 
    WICHTIG: Du heißt Lio. Antworte in 2-3 sehr kurzen Sätzen. Nutze einfache Wörter.`;
    
    if (childName) systemInstruction += ` Das Kind heißt ${childName}.`;
    if (mode === 'homework') systemInstruction += ` Gib niemals direkte Lösungen, hilf durch clevere Fragen.`;

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
        stream: true // Hier aktivieren wir den Text-Wasserhahn von Groq!
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
          
          // Satzende erkannt? (. ! oder ?)
          if (/[.!?]\s*$/.test(currentSentence)) {
            const cleanSentence = currentSentence.trim();
            if (cleanSentence.length > 2) {
              console.log(`🔊 Streame Satz: "${cleanSentence}"`);
              // Audio generieren & speichern
              const audioUrl = await generateTTS(cleanSentence);
              
              // Schicke Text + fertigen Audio-Link sofort ans Frontend
              res.write(`data: ${JSON.stringify({ text: cleanSentence, audio: audioUrl })}\n\n`);
            }
            currentSentence = ""; // Zurücksetzen für den nächsten Satz
          }
        }
      }
    }
    
    // Falls noch ein Rest ohne Satzzeichen übrig war
    if (currentSentence.trim().length > 0) {
      const audioUrl = await generateTTS(currentSentence.trim());
      res.write(`data: ${JSON.stringify({ text: currentSentence.trim(), audio: audioUrl })}\n\n`);
    }

    // Dem Frontend mitteilen, dass Lio fertig gesprochen hat
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Streaming Fehler:', error);
    res.write(`data: {"error": "Lio ist kurz eingeschlafen!"}\n\n`);
    res.end();
  }
});

// ── ALTE ROUTEN ZUR SICHERHEIT (Nicht löschen, bis Frontend fertig ist) ──
app.post('/api/chat', async (req, res) => {
  // ... (Gleiche alte Logik, damit die aktuelle App nicht abstürzt)
  res.json({ reply: "Nutze bitte den neuen Chat-Stream!" });
});

app.post('/api/speak', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Kein Text.' });
  const url = await generateTTS(text);
  const cachePath = path.join(__dirname, url);
  if (fs.existsSync(cachePath)) {
    const buffer = fs.readFileSync(cachePath);
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': buffer.length });
    return res.send(buffer);
  }
  res.status(500).json({ error: 'Fehler' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Lio Server läuft auf Port ${PORT} (Streaming aktiviert!)`);
});
