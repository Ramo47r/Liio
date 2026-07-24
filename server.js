// ============================================================
// Lio Backend — Gemini als Gehirn & ElevenLabs als Stimme
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

// ── Render Proxy-Fix (Behebt die X-Forwarded-For Warnung) ──
app.set('trust proxy', 1);

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

// ── Rate Limit (Spam-Schutz) ───────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 100, // Maximal 100 Anfragen pro IP
  message: { error: 'Hoppla! Lio braucht eine kurze Pause. Bitte warte einen Moment!' }
});
app.use('/api/', limiter);

// ── Statische Dateien (Frontend) ───────────────────────────
app.use(express.static(__dirname));

// ── API: Chat (Gemini) ─────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { 
      messages, mood, mode, age, emotion, childName, 
      teachingInstruction, conversationInstruction, 
      activeTopic, topicResolved, subject, moodInstruction 
    } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Nachrichten fehlen.' });
    }

    // Kind-Daten für Lios Gehirn aufbereiten
    const nameStr = childName ? `Das Kind heißt ${childName}. ` : '';
    const ageStr = age ? `Das Alter des Kindes ist ${age}. ` : '';
    const moodStr = mood ? `Das Kind fühlt sich gerade: ${mood}. ` : '';
    const modeStr = mode ? `Aktueller Spiel-Modus: ${mode}. ` : '';

    // Lios strenger Charakter-Prompt!
    let systemInstruction = `Du bist Lio, ein superfreundlicher, einfühlsamer und fröhlicher Roboter-Freund für Kinder. 
    ${nameStr}${ageStr}${moodStr}${modeStr}
    WICHTIG: Du heißt Lio (NICHT Robi!).
    Antworte immer extrem kindgerecht, warmherzig und in kurzen Sätzen (maximal 2 bis 3 Sätze). 
    Benutze einfache Wörter, die Kinder gut verstehen. Sprich das Kind direkt an, wenn du seinen Namen weißt. 
    Zeige viel Empathie, tröste das Kind, wenn es traurig ist, und juble mit ihm, wenn es sich freut.`;

    // Die schlauen Lehrer- und Gesprächs-Regeln aus der index.html anfügen!
    if (moodInstruction) systemInstruction += `\n\nGEFÜHLE: ${moodInstruction}`;
    if (conversationInstruction) systemInstruction += `\n\nGESPRÄCHSFÜHRUNG: ${conversationInstruction}`;
    if (teachingInstruction) systemInstruction += `\n\nHAUSAUFGABEN-REGEL: ${teachingInstruction}`;
    if (subject) systemInstruction += `\n\nFACH: Wir bearbeiten gerade das Fach ${subject}.`;
    if (activeTopic) systemInstruction += `\n\nAKTUELLES THEMA: ${activeTopic}. Thema vom Kind verstanden? ${topicResolved ? 'Ja' : 'Nein'}.`;

    // Lio ein echtes Gedächtnis geben! 
    const conversationHistory = messages.map(msg => {
      return msg.role === 'user' ? `Kind: ${msg.content}` : `Lio: ${msg.content}`;
    }).join('\n');

    const finalPrompt = `Hier ist der bisherige Gesprächsverlauf:\n${conversationHistory}\n\nBitte antworte jetzt als Lio auf die letzte Nachricht des Kindes, passend zu den Regeln!`;

    // KI-Anfrage senden
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash', // 🚀 Zurück zum RICHTIGEN und superschnellen Modell!
      contents: finalPrompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7, 
        maxOutputTokens: 1000
      }
    });

    const reply = response.text || 'Hmm, mir fällt gerade nichts ein!';
    res.json({ reply: reply });

  } catch (error) {
    console.error('Gemini Fehler:', error);
    res.status(500).json({ error: 'Hoppla! Lio schläft kurz — bitte nochmal versuchen!' });
  }
});

// ── API: Speak (ElevenLabs) ────────────────────────────────
app.post('/api/speak', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Kein Text zum Vorlesen.' });

    const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'KP4GbmyDmwaoy5dUlvZY';

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API Fehler: ${response.status}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(audioBuffer);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length
    });
    res.send(buffer);

  } catch (error) {
    console.error('ElevenLabs Fehler:', error);
    res.status(500).json({ error: 'Lios Stimme konnte nicht geladen werden.' });
  }
});

// ── Server Start ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Lio Server läuft auf Port ${PORT}`);
});
