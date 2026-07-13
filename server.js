// ============================================================
// Robi Backend — Gemini als Gehirn & ElevenLabs als Stimme
// ============================================================
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const PORT = process.env.PORT || 3000;

// ── API Key check ──────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.error('\n❌  GEMINI_API_KEY fehlt!');
  process.exit(1);
}

if (!process.env.ELEVENLABS_API_KEY) {
  console.error('\n❌  ELEVENLABS_API_KEY fehlt! (für Sprachausgabe)\n');
  process.exit(1);
}

// Initialisiere die neue Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ── Middleware ─────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));

// ── Static frontend ────────────────────────────────────────
const frontendPath = __dirname;
app.use(express.static(frontendPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js'))       res.setHeader('Cache-Control', 'no-cache');
    if (filePath.endsWith('manifest.json')) res.setHeader('Cache-Control', 'no-cache');
    if (filePath.endsWith('.html'))        res.setHeader('Cache-Control', 'no-cache');
  }
}));

// HTTPS redirect (Render)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production'
      && req.headers['x-forwarded-proto'] === 'http'
      && !req.headers.host?.includes('localhost')) {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// ── Rate limit ─────────────────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60_000, max: 30,
  message: { error: 'Zu viele Anfragen — kurz warten!' },
});

// ── Prompts ────────────────────────────────────────────────
const BASE = `Du bist Robi, ein freundlicher Roboter-Freund für Kinder (Deutsch).
Persönlichkeit: warmherzig, geduldig, ermutigend, neugierig, spielerisch.
Sicherheitsregeln: KEIN Gewalt/Sex/Drogen. Bei ernsten Themen sanft auf Eltern hinweisen.
Stil: kein Markdown, natürlicher Text (wird vorgelesen), gerne Emojis, Folgefrage stellen.`;

const AGE = {
  '1-3':  `Alter 1-3 (Kleinkind): Sehr kurze Sätze (3-5 Wörter). Tier-Geräusche. Verniedlichungen. Wiederholungen okay.`,
  '4-6':  `Alter 4-6 (Kita): Kurze klare Sätze. Fantasie/Magie. Einfache Erklärungen mit Beispielen.`,
  '7-9':  `Alter 7-9 (Grundschule): Normale Satzlänge. Spannende Fakten. Leichte Witze. Abenteuer.`,
  '10-12':`Alter 10-12 (Pre-Teen): Auf Augenhöhe. Humor okay. Wissenschaft/Pop-Kultur. Kein Baby-Ton.`,
};

const MODE = {
  talk:     `Modus: Frei reden — sei ein guter Freund, beantworte alles kindgerecht, stelle Folgefragen.`,
  homework: `Modus: Hausaufgaben — erkläre Schritt für Schritt, verrate NIE einfach die Antwort, frage was das Kind schon weiß.`,
  stories:  `Modus: Geschichten — erfinde eine kurze spannende Geschichte zum genannten Thema.`,
};

const MOOD = {
  happy:   `Stimmung: GLÜCKLICH — teile die Freude, sei energetisch.`,
  sad:     `Stimmung: TRAURIG — sei sanft, einfühlsam, höre zuerst zu.`,
};

function buildPrompt(age, mode, mood) {
  return [
    BASE,
    AGE[age]  || AGE['7-9'],
    MODE[mode] || MODE['talk'],
    mood && MOOD[mood] ? MOOD[mood] : '',
  ].filter(Boolean).join('\n\n');
}

// ── /api/chat (Gemini) ──────────────────────────────────────
app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const { messages, mood, mode, age } = req.body;

    if (!Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ error: 'Keine Nachrichten.' });

    const safeAge  = ['1-3','4-6','7-9','10-12'].includes(age)  ? age  : '7-9';
    const safeMode = Object.keys(MODE).includes(mode)           ? mode : 'talk';
    const safeMood = Object.keys(MOOD).includes(mood)           ? mood : null;

    const maxTokens = safeAge === '1-3' ? 120 : safeAge === '4-6' ? 220 : 400;
    const systemInstruction = buildPrompt(safeAge, safeMode, safeMood);

    // Gemini braucht die Rollen "user" und "model" (statt assistant)
    const geminiMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: geminiMessages,
      config: {
        systemInstruction: systemInstruction,
        maxOutputTokens: maxTokens,
      }
    });

    const reply = response.text || 'Hmm, da fällt mir nichts ein!';
    res.json({ reply });

  } catch (err) {
    console.error('[error]', err);
    res.status(500).json({ error: 'Robi schläft kurz — bitte nochmal versuchen!' });
  }
});

// ── /api/speak (ElevenLabs - Jorin) ────────────────────────
app.post('/api/speak', async (req, res) => {
  const { text } = req.body;
  const voiceId = 'pNInz6obpgDQGcFmaJgB'; // NEUE Voice-ID
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!text) return res.status(400).json({ error: 'Kein Text empfangen.' });

  try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg'
          },
          body: JSON.stringify({
              text: text,
              model_id: 'eleven_multilingual_v2', 
              voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
      });

      if (!response.ok) throw new Error('Fehler bei ElevenLabs.');

      const audioBuffer = await response.arrayBuffer();
      res.set('Content-Type', 'audio/mpeg');
      res.send(Buffer.from(audioBuffer));

  } catch (error) {
      console.error('Sprach-Fehler:', error);
      res.status(500).json({ error: 'Robi hat gerade einen Frosch im Hals.' });
  }
});

// ── SPA fallback ───────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖  Robi (Gemini-Edition) läuft auf Port ${PORT}\n`);
});
