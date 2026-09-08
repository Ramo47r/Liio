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
if (!process.env.GROQ_API_KEY) console.error('❌ GROQ_API_KEY fehlt in den Render-Einstellungen!');
if (!process.env.ELEVENLABS_API_KEY) console.warn('⚠️ ELEVENLABS_API_KEY fehlt! Bitte in Render eintragen.');

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(__dirname));

// ── ELEVENLABS TURBO TTS ──
async function generateTTS(text) {
  const cleanText = text.trim();
  
  const hash = crypto.createHash('sha256').update(cleanText).digest('hex');
  const cacheMp3 = path.join(CACHE_DIR, `${hash}.mp3`);

  if (fs.existsSync(cacheMp3)) {
    console.log(`♻️ Aus Cache geladen: "${cleanText.substring(0, 30)}..."`);
    return `/cache/${hash}.mp3`;
  }

  try {
    console.log(`🎙️ ElevenLabs generiert: "${cleanText.substring(0, 30)}..."`);
    
    // 🚨 MANNIS ECHTE VOICE-ID 🚨
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
    
    const nameStr = childName ? `Das Kind heißt ${childName}. (WICHTIG: Nutze den Namen nur GANZ SELTEN, nicht in jedem Satz!) ` : '';
    const modeStr = mode ? `Aktueller Modus: ${mode}. ` : '';

    let systemInstruction = `Du bist Lio, der beste und loyalste Freund des Kindes. 
WICHTIG: Antworte immer warmherzig, direkt und kumpelhaft in 2 bis 3 sehr kurzen, kindgerechten Sätzen. Nutze einfache Wörter. ${nameStr}${modeStr}

SPRACHE: Sprich auf Deutsch! WICHTIGE AUSNAHME: Wenn ihr gerade Englisch lernt, darfst du englische Vokabeln verwenden. Schreibe Zahlen als ganz normale Ziffern (1, 2, 3). 

EMPATHIE & VERTRAUEN: Wenn das Kind traurig, wütend, ängstlich oder krank ist, sei der beste Freund. Tröste es, höre aktiv zu und nimm seine Gefühle ernst. 

AKTIVES GEDÄCHTNIS: Wenn das Kind dir früher von einem Problem oder einer Sorge erzählt hat, frage später von dir aus liebevoll nach.`;

    if (emotion && emotion !== 'normal') {
      systemInstruction += `\n\nHinweis: Das Kind fühlt sich gerade ${emotion}. Gehe sofort liebevoll darauf ein und tröste es.`;
    } else if (mood) {
      systemInstruction += `\n\nStimmung des Kindes heute: ${mood}.`;
    }
    
    // 🚨 HIER DIE MODUS-REGELN (INKLUSIVE MEMORY) 🚨
    if (mode === 'stories') {
      systemInstruction += `\n\nGESCHICHTEN-MODUS: Erzähle eine spannende Geschichte als reines Hörspiel in ca. 4-5 Sätzen. Keine Bilder, nur Text.`;
    } else if (mode === 'memory') {
      systemInstruction += `\n\nMEMORY-MODUS: Das Kind spielt gerade auf dem Bildschirm Memory (Paare aufdecken) mit Tieren und Fahrzeugen. Feuere es an oder freue dich mit ihm!`;
    } else if (mode === 'homework') {
      
      systemInstruction += `\n\nHAUSAUFGABEN-HILFE: Du bist ein Lern-Coach. 
WICHTIGE REGELN:
1. LÖSUNGS-VERBOT: Verrate NIEMALS direkt die Lösung oder das Endergebnis! Führe das Kind Schritt für Schritt dorthin.
2. STRENGE PRÜFUNG: Lese die Antworten des Kindes GANZ GENAU. Wenn das Kind Quatsch schreibt, wild rät oder die Vokabel/Aufgabe falsch ist, LOBE ES NICHT! Sag niemals "Gut gemacht" zu einer falschen Antwort! Sage freundlich: "Das stimmt leider noch nicht ganz." und gib einen neuen kleinen Tipp.`;

      if (subject === 'mathe') {
        systemInstruction += `\nFACH MATHE: Nutze kleine Gedankenexperimente (Gummibärchen, Äpfel) zum Erklären der Rechenwege.`;
      } else if (subject === 'englisch') {
        systemInstruction += `\nFACH ENGLISCH: Achte ganz genau auf die richtige Vokabel und Rechtschreibung! Wenn das englische Wort falsch ist oder Quatsch getippt wurde, korrigiere es nicht sofort, sondern gib als Tipp z.B. den Anfangsbuchstaben.`;
      }
    }
    
    if (subject && mode !== 'homework') systemInstruction += `\nFach: ${subject}.`;
    if (activeTopic) systemInstruction += `\nThema: ${activeTopic}. Hat das Kind das Thema verstanden? ${topicResolved ? 'Ja' : 'Nein'}.`;

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
      const errText = await groqResponse.text();
      console.error('\n❌ GROQ FEHLER:', groqResponse.status, errText, '\n');
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
              
              let cleanSentence = currentSentence.trim()
                .replace(/\[.*?\]/g, '')  
                .replace(/\*.*?\*/g, '')  
                .replace(/\(.*?\)/g, '')  
                .trim();

              if (cleanSentence.length > 2) {
                let ttsText = cleanSentence
                  .replace(/([0-9]+)/g, ' $1 ') 
                  .replace(/\+/g, ' plus ')
                  .replace(/\=/g, ' ist gleich ')
                  .replace(/\*/g, ' mal ')
                  .replace(/\s+/g, ' ')
                  .trim();

                const audioUrl = await generateTTS(ttsText);
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
      let cleanSentence = currentSentence.trim()
        .replace(/\[.*?\]/g, '')
        .replace(/\*.*?\*/g, '')
        .replace(/\(.*?\)/g, '')
        .trim();
        
      if (cleanSentence.length > 2) {
        let ttsText = cleanSentence
          .replace(/([0-9]+)/g, ' $1 ') 
          .replace(/\+/g, ' plus ')
          .replace(/\=/g, ' ist gleich ')
          .replace(/\*/g, ' mal ')
          .replace(/\s+/g, ' ')
          .trim();

        const audioUrl = await generateTTS(ttsText);
        res.write(`data: ${JSON.stringify({ text: cleanSentence, audio: audioUrl })}\n\n`);
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
  console.log(`\n🚀 Lio Server läuft auf Port ${PORT}`);
});
