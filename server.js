// ============================================================
// KidsBot.ai / Lio Backend — Pures KI-Backend (100% ohne ElevenLabs & VIP-Schutz)
// ============================================================
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ── API Key Prüfung ──
if (!process.env.GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY fehlt in den Render-Einstellungen!');
}

// Erlaubt alle Anfragen von deiner GitHub-Website
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));

// Der VIP-Schutz wurde komplett entfernt, damit die API frei erreichbar ist!

app.use(express.static(__dirname));

// ── API: Chat-Stream (Wasserhahn - Nur Text) ──
app.post('/api/chat-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { messages, childName, mode, mood, activeTopic, topicResolved, subject, emotion, age, lang } = req.body;
    const isEn = lang === 'en';

    let systemInstruction = "";
    if (isEn) {
      const nameStr = childName ? `The child's name is ${childName}. (IMPORTANT: Use the name VERY RARELY!) ` : '';
      const modeStr = mode ? `Current mode: ${mode}. ` : '';
      systemInstruction = `You are Lio, the child's best and most loyal friend. 
IMPORTANT: Always answer in a warm, direct, and friendly tone using very short sentences. Use simple words. ${nameStr}${modeStr}
LANGUAGE: Speak in English! Write numbers as normal digits (1, 2, 3).`;
      
      if (mode === 'homework') {
        systemInstruction += `\n\nHOMEWORK HELP: You are a Socratic learning coach. NEVER give away the direct solution! Guide the child step-by-step.`;
      }
    } else {
      const nameStr = childName ? `Das Kind heißt ${childName}. (WICHTIG: Nutze den Namen nur GANZ SELTEN!) ` : '';
      const modeStr = mode ? `Aktueller Modus: ${mode}. ` : '';
      systemInstruction = `Du bist Lio, der beste und loyalste Freund des Kindes. 
WICHTIG: Antworte immer warmherzig, direkt und kumpelhaft in sehr kurzen Sätzen. Nutze einfache Wörter. ${nameStr}${modeStr}
SPRACHE: Sprich auf Deutsch! Schreibe Zahlen als ganz normale Ziffern (1, 2, 3).`;

      if (mode === 'homework') {
        systemInstruction += `\n\nHAUSAUFGABEN-HILFE: Du bist ein Lern-Coach. Verrate NIEMALS direkt die Lösung! Führe das Kind Schritt für Schritt dorthin.`;
      }
    }

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
        model: 'openai/gpt-oss-20b',
        messages: formattedMessages,
        temperature: 0.7, 
        stream: true
      })
    });

    if (!groqResponse.ok) {
      throw new Error(`Groq Fehler ${groqResponse.status}`);
    }

    const reader = groqResponse.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let currentSentence = "";
    let streamBuffer = "";
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop();
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
          const dataStr = trimmedLine.slice(6).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            const token = data.choices[0]?.delta?.content || "";
            currentSentence += token;
            
            if (/[.!?]\s*$/.test(currentSentence)) {
              let cleanSentence = currentSentence.trim().replace(/\[.*?\]/g, '').replace(/\*.*?\*/g, '').replace(/\(.*?\)/g, '').trim();
              if (cleanSentence.length > 2) {
                res.write(`data: ${JSON.stringify({ text: cleanSentence })}\n\n`);
              }
              currentSentence = ""; 
            }
          } catch (e) {
            console.error('[Puffer] Repariert.');
          }
        }
      }
    }
    
    if (currentSentence.trim().length > 0) {
      let cleanSentence = currentSentence.trim().replace(/\[.*?\]/g, '').replace(/\*.*?\*/g, '').replace(/\(.*?\)/g, '').trim();
      if (cleanSentence.length > 2) {
        res.write(`data: ${JSON.stringify({ text: cleanSentence })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Streaming Fehler:', error.message);
    res.write(`data: {"error": "Lio ist kurz eingeschlafen!"}\n\n`);
    res.end();
  }
});

// ── Dummy Endpunkt ──
app.post('/api/speak', (req, res) => {
  res.status(404).json({ error: 'TTS wurde im Server deaktiviert.' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 KidsBot.ai Server läuft auf Port ${PORT} (API frei erreichbar)`);
});
