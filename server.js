// ============================================================
// KidsBot.ai / Lio Backend — Pures KI-Backend (ohne ElevenLabs)
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

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true }));

// ════════════════════════════════════════════════════════════
// ── VIP PASSWORT-SCHUTZ FÜR INVESTOREN
// ════════════════════════════════════════════════════════════
app.post('/vip-login', (req, res) => {
  if (req.body.password === 'VIPLIO') {
    res.setHeader('Set-Cookie', 'lio_vip=1; Path=/; HttpOnly; Max-Age=2592000');
    res.redirect('/');
  } else {
    res.send('<script>alert("Falsches Passwort!"); window.location.href="/";</script>');
  }
});

app.use((req, res, next) => {
  const url = req.path;
  if (url === '/' || url === '/index.html' || url === '/en.html' || url.startsWith('/api/')) {
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('lio_vip=1')) {
      if (url.startsWith('/api/')) {
        return res.status(401).json({ error: 'Nicht autorisiert. Bitte einloggen.' });
      }
      return res.send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>KidsBot.ai - VIP Access</title>
          <style>
            body { background: #0A1017; color: #EAFBF5; font-family: 'Nunito', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .box { background: rgba(14,22,32,0.9); padding: 40px 30px; border-radius: 20px; border: 1px solid rgba(79,227,193,0.3); text-align: center; box-shadow: 0 10px 50px rgba(0,0,0,0.6); max-width: 340px; width: 90%; }
            h2 { margin-top: 0; margin-bottom: 8px; font-size: 24px; font-family: 'Baloo 2', sans-serif; }
            p { font-size: 14px; color: rgba(234,251,245,0.6); margin-bottom: 24px; line-height: 1.4; }
            input { width: 100%; padding: 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.18); border-radius: 12px; color: #fff; font-size: 16px; text-align: center; margin-bottom: 16px; box-sizing: border-box; outline: none; }
            input:focus { border-color: #4FE3C1; box-shadow: 0 0 0 3px rgba(79,227,193,0.15); }
            button { width: 100%; padding: 15px; background: linear-gradient(135deg, #4FE3C1 0%, #B8F24A 100%); color: #04241C; border: none; border-radius: 12px; font-weight: 900; font-size: 16px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; transition: transform 0.15s; }
            button:active { transform: translateY(2px); }
          </style>
        </head>
        <body>
          <div class="box">
            <h2>🔒 Investor Access</h2>
            <p>Bitte gib das VIP-Passwort ein, um KidsBot.ai zu testen.</p>
            <form action="/vip-login" method="POST">
              <input type="password" name="password" placeholder="Passwort eingeben..." required autofocus>
              <button type="submit">Eintreten</button>
            </form>
          </div>
        </body>
        </html>
      `);
    }
  }
  next();
});
// ════════════════════════════════════════════════════════════

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
                // Sende NUR noch Text an das Frontend (keine Audio-URL mehr!)
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

// ── Dummy Endpunkt (sorgt dafür, dass die App nicht abstürzt, wenn sie nach Audio fragt) ──
app.post('/api/speak', (req, res) => {
  res.status(404).json({ error: 'TTS wurde im Server deaktiviert.' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 KidsBot.ai Server läuft auf Port ${PORT} (100% ohne ElevenLabs)`);
});
