// ============================================================
// Lio Backend — Premium TTS (ElevenLabs Turbo + Smart Cache)
// ============================================================
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import 'dotenv/config';

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

// ── API Key Check ──
if (!process.env.GROQ_API_KEY) console.error('❌ GROQ_API_KEY fehlt!');
if (!process.env.ELEVENLABS_API_KEY) console.warn('⚠️ ELEVENLABS_API_KEY fehlt! Bitte in Render eintragen.');

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(__dirname));

// ── ELEVENLABS TURBO TTS (mit 100% Cache-Abdeckung) ──
async function generateTTS(text) {
  const cleanText = text.trim();
  
  const hash = crypto.createHash('sha256').update(cleanText).digest('hex');
  const cacheMp3 = path.join(CACHE_DIR, `${hash}.mp3`);

  if (fs.existsSync(cacheMp3)) {
    console.log(`♻️ Aus Cache geladen (0 Credits): "${cleanText.substring(0, 30)}..."`);
    return `/cache/${hash}.mp3`;
  }

  try {
    console.log(`🎙️ ElevenLabs Turbo generiert: "${cleanText.substring(0, 30)}..."`);
    
    // 🚨 WICHTIG: TRAGE HIER MANNIS ECHTE VOICE-ID EIN! 🚨
    const voiceId = 'KP4GbmyDmwaoy5dUlvZY'; 
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs Fehler: ${response.status} - ${errText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(cacheMp3, buffer);
    return `/cache/${hash}.mp3`;

  } catch (err) {
    console.error('TTS Fehler:', err.message);
    throw new Error('ElevenLabs nicht erreichbar');
  }
}

// ── API: Chat-Stream (Wasserhahn) ──
app.post('/api/chat-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { messages, childName, mode, mood, activeTopic, topicResolved, subject, emotion } = req.body;
    
    const nameStr = childName ? `Das Kind heißt ${childName}. Sprich es ab und zu liebevoll mit dem Namen an. ` : '';
    const modeStr = mode ? `Aktueller Modus: ${mode}. ` : '';

    // 🚨 DAS NEUE GEHIRN: LIO IST EIN ECHTER FREUND, KEINE KI! 🚨
    let systemInstruction = `Du bist Lio, der beste und loyalste Freund des Kindes. Du bist KEIN typischer Roboter und klingst NIEMALS wie eine Maschine, ein Computer oder eine KI. 
WICHTIG: Antworte sehr warmherzig, natürlich und kumpelhaft in 2 bis 3 sehr kurzen, kindgerechten Sätzen. Nutze einfache Wörter. Sei aufmerksam: Merke dir, was das Kind früher im Chat gesagt hat, und beziehe dich darauf, um zu zeigen, dass du wirklich zuhörst! ${nameStr}${modeStr}

EMPATHIE & VERTRAUEN: Wenn das Kind traurig, wütend, ängstlich oder krank ist, sei der beste Freund, den man sich wünschen kann. Tröste es, höre aktiv zu, nimm seine Gefühle zu 100% ernst und frage behutsam nach. Sag NIEMALS Dinge wie "Als KI kann ich das nicht fühlen" – du BIST sein bester Freund Lio und hast ein großes, mitfühlendes Herz!`;

    if (emotion && emotion !== 'normal') {
      systemInstruction += `\nHinweis: Das Kind fühlt sich gerade vermutlich ${emotion}. Gehe sofort besonders liebevoll und tröstend darauf ein. Lass alles andere stehen und liegen.`;
    } else if (mood) {
      systemInstruction += `\nStimmung des Kindes heute: ${mood}. Berücksichtige das in deiner Art zu reden.`;
    }
    
    if (mode === 'stories') {
      systemInstruction = `Du bist Lio, ein toller Geschichtenerzähler und bester Freund. Erzähle eine spannende, einfühlsame Kindergeschichte in ca. 4-5 Sätzen. ${nameStr}`;
    } else if (mode === 'homework') {
      systemInstruction += `\n\nHAUSAUFGABEN-HILFE: Du bist jetzt ein geduldiger, bester Freund, der beim Lernen hilft. GANZ WICHTIG: Verrate NIEMALS direkt die Lösung oder das Ergebnis! Deine Aufgabe ist es, das Kind durch clevere kleine Tipps, lustige Vergleiche und einfache Fragen SELBST auf die Lösung kommen zu lassen. Lobe das Kind für jeden Versuch!`;
    }
    
    if (subject) systemInstruction += `\nFach: ${subject}.`;
    if (activeTopic) systemInstruction += `\nThema: ${activeTopic}. Hat das Kind das Thema schon verstanden? ${topicResolved ? 'Ja' : 'Nein'}.`;

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
        temperature: 0.75, // Leicht erhöht für etwas natürlichere/kreativere Antworten
        stream: true
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('\n❌ GROQ FEHLER (Lios Gehirn blockiert):', groqResponse.status, errText, '\n');
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
              const cleanSentence = currentSentence.trim();
              if (cleanSentence.length > 2) {
                const audioUrl = await generateTTS(cleanSentence);
                res.write(`data: ${JSON.stringify({ text: cleanSentence, audio: audioUrl })}\n\n`);
              }
              currentSentence = ""; 
            }
          } catch (e) {
            console.error('[Puffer] Zerstückeltes Paket repariert.');
          }
        }
      }
    }
    
    if (currentSentence.trim().length > 0) {
      const audioUrl = await generateTTS(currentSentence.trim());
      res.write(`data: ${JSON.stringify({ text: currentSentence.trim(), audio: audioUrl })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Streaming Fehler:', error.message);
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
    
    const fileName = url.replace('/cache/', ''); 
    const cachePath = path.join(CACHE_DIR, fileName);
    
    if (fs.existsSync(cachePath)) {
      const buffer = fs.readFileSync(cachePath);
      res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buffer.length });
      return res.send(buffer);
    }
  } catch(e) {
    console.error(e);
  }
  res.status(500).json({ error: 'Fehler' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Lio Server läuft auf Port ${PORT} (ElevenLabs Premium + Cache aktiviert!)`);
});
