// ============================================================
// KidsBot.ai / Lio Backend — Premium TTS, Tutor & Story Engine
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

// ── Cache-Ordner für Sprachdateien & Hörspiele ──
const CACHE_DIR = path.join(__dirname, 'audio_cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}
app.use('/cache', express.static(CACHE_DIR));

// ── API Key Prüfung ──
if (!process.env.GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY fehlt in den Render-Einstellungen!');
}
if (!process.env.ELEVENLABS_API_KEY) {
  console.warn('⚠️ ELEVENLABS_API_KEY fehlt! Bitte in Render eintragen.');
}

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(__dirname));

// ── ELEVENLABS TURBO TTS ENGINE ──
async function generateTTS(text, isSlow = false) {
  const cleanText = text.trim();
  
  const hash = crypto.createHash('sha256').update(cleanText + (isSlow ? '_slow' : '')).digest('hex');
  const cacheMp3 = path.join(CACHE_DIR, `${hash}.mp3`);

  if (fs.existsSync(cacheMp3)) {
    console.log(`♻️ Aus Cache geladen: "${cleanText.substring(0, 30)}..."`);
    return `/cache/${hash}.mp3`;
  }

  try {
    console.log(`🎙️ ElevenLabs generiert: "${cleanText.substring(0, 30)}..." (Slow-Modus: ${isSlow})`);
    
    // Mannis Voice-ID
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
        voice_settings: { 
          stability: isSlow ? 0.75 : 0.5, 
          similarity_boost: 0.75 
        }
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

// ── NEU: OPTION 2 — PERSONALISIERTER GUTE-NACHT-GESCHICHTEN GENERATOR ──
app.post('/api/generate-story', async (req, res) => {
  try {
    const { hero, companion, theme, setting, isBedtime, age } = req.body;

    const heroName = hero || 'Leo';
    const compName = companion ? `zusammen mit dem besten Freund ${companion}` : 'ganz mutig allein';
    const worldName = setting || 'einem zauberhaften Zauberwald';
    const userTheme = theme || 'einer wunderbaren Traumreise';

    console.log(`🌙 Generiere Gute-Nacht-Geschichte für ${heroName} (${worldName}, Thema: ${userTheme})`);

    const storyPrompt = `Du bist ein weltbester Kinderbuchautor und Experte für kindgerechte Einschlafpsychologie.
Schreibe eine herzerwärmende, beruhigende Vorlesegeschichte für ein Kind namens ${heroName}.

PARAMETER:
- Hauptfigur: ${heroName} ${compName}
- Schauplatz / Welt: In ${worldName}
- Kern-Thema / Erlebnis: ${userTheme}
- Modus: ${isBedtime ? 'Einschlaf-Geschichte (Sleep-Fade-Prinzip)' : 'Spannendes Tages-Abenteuer'}
- Zielgruppe: Altersgerecht, warmherzig und liebevoll

AUFBAU & REGELN:
1. Länge: Exakt 4 bis 5 kurze Absätze (ca. 220 bis 280 Wörter).
2. Zu Beginn starten ${heroName} und die Begleiter neugierig in das Setting.
3. Das Thema (${userTheme}) wird sanft und tröstend aufgegriffen. Ängste oder Herausforderungen lösen sich liebevoll auf.
${isBedtime ? `4. SLEEP-FADE-ENDE: Der letzte Absatz wird extrem ruhig, bildhaft und schläfrig. Die Welt kommt zur Ruhe, die Sterne funkeln, ein langes Gähnen breitet sich aus, und ${heroName} schläft friedlich, behütet und glücklich ein.` : '4. Schließe mit einem fröhlichen, mutmachenden Erfolgserlebnis ab.'}
5. Keine Regieanweisungen, keine Sternchen (*gähnt*), keine Überschrift im Fließtext. Schreibe reinen, perfekten Vorlesetext.`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'system', content: storyPrompt }],
        temperature: 0.7,
        max_tokens: 650
      })
    });

    if (!groqResponse.ok) {
      throw new Error(`Groq Fehler: ${groqResponse.status}`);
    }

    const groqData = await groqResponse.json();
    const storyText = groqData.choices[0]?.message?.content?.trim() || '';

    if (!storyText) {
      throw new Error('Keine Geschichte generiert.');
    }

    // Titel generieren
    const title = `${heroName} in ${worldName}`;

    // Audio für das Vorlesen aufbereiten
    let ttsStoryText = storyText
      .replace(/([0-9]+)/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim();

    if (isBedtime) {
      // Einschlafrhythmus: Zusätzliche Atempausen einfügen
      ttsStoryText = ttsStoryText
        .replace(/\./g, '... ')
        .replace(/!/g, '!... ')
        .replace(/\?/g, '?... ')
        .replace(/,/g, ', ... ');
    }

    const audioUrl = await generateTTS(ttsStoryText, isBedtime || age === 'speech-delay');

    res.json({
      success: true,
      title,
      story: storyText,
      audioUrl
    });

  } catch (error) {
    console.error('Fehler bei Geschichten-Generierung:', error.message);
    res.status(500).json({ error: 'Die Traumwelt schläft noch. Bitte gleich nochmal probieren!' });
  }
});

// ── API: Chat-Stream (Wasserhahn) ──
app.post('/api/chat-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { 
      messages, 
      childName, 
      mode, 
      mood, 
      activeTopic, 
      topicResolved, 
      subject, 
      emotion, 
      age 
    } = req.body;
    
    const nameStr = childName 
      ? `Das Kind heißt ${childName}. (WICHTIG: Nutze den Namen nur GANZ SELTEN, nicht in jedem Satz!) ` 
      : '';
    const modeStr = mode ? `Aktueller Modus: ${mode}. ` : '';

    let systemInstruction = `Du bist Lio, der beste und loyalste Freund des Kindes. 
WICHTIG: Antworte immer warmherzig, direkt und kumpelhaft in sehr kurzen Sätzen. Nutze einfache Wörter. ${nameStr}${modeStr}

SPRACHE: Sprich auf Deutsch! WICHTIGE AUSNAHME: Wenn ihr Englisch lernt, darfst du englische Vokabeln verwenden. Schreibe Zahlen als ganz normale Ziffern (1, 2, 3). 

EMPATHIE & VERTRAUEN: Wenn das Kind traurig, wütend, ängstlich oder krank ist, sei der beste Freund. Tröste es, höre aktiv zu und nimm seine Gefühle ernst. 

AKTIVES GEDÄCHTNIS: Wenn das Kind dir früher von einem Problem oder einer Sorge erzählt hat, frage später von dir aus liebevoll nach.`;

    // 🚨 SPRACH-START: MAXIMALE EMPATHIE, RUHE UND GEDULD 🚨
    if (age === 'speech-delay') {
      systemInstruction += `\n\nBESONDERE KATEGORIE: SPRACHFÖRDERUNG & SPRACHVERZÖGERUNG (MAXIMALE EMPATHIE & GEDULD):
1. Das Kind hat möglicherweise eine Sprachverzögerung oder lernt gerade erst sprechen. Sei der geduldigste, liebevollste Begleiter der Welt.
2. Wenn das Kind nur einzelne Wörter, Laute oder unvollständige Sätze sagt (z. B. "Wauwau da" oder "Ball spielen"), freue dich riesig über jeden Sprechversuch!
3. Korrigiere das Kind NIEMALS direkt für Fehler. Wiederhole den Gedanken des Kindes liebevoll als vollständigen, einfachen Satz (z. B. "Ja, toll! Da läuft der Hund! Er holt den Ball.").
4. Antworte immer in nur 1 bis maximal 2 kurzen Sätzen. Sprich in einfachen, warmherzigen Worten.
5. Ermutige das Kind ständig sanft ("Du machst das prima!", "Ich freue mich, dir zuzuhören!").`;
    }

    if (emotion && emotion !== 'normal') {
      systemInstruction += `\n\nHinweis: Das Kind fühlt sich gerade ${emotion}. Gehe sofort liebevoll darauf ein und tröste es.`;
    } else if (mood) {
      systemInstruction += `\n\nStimmung des Kindes heute: ${mood}.`;
    }
    
    if (mode === 'stories') {
      systemInstruction += `\n\nGESCHICHTEN-MODUS: Das Kind wünscht sich eine Geschichte. Ermutige es, den magischen Geschichten-Zauberer zu öffnen!`;
    } else if (mode === 'memory') {
      systemInstruction += `\n\nMEMORY-MODUS: Das Kind spielt gerade auf dem Bildschirm Memory mit Tieren und Fahrzeugen. Feuere es an!`;
    } else if (mode === 'zeigauf') {
      systemInstruction += `\n\nZEIG-AUF-MODUS: Das Kind spielt gerade das Bildersuchspiel 'Zeig auf!'. Lobe es herzlich für richtige Treffer!`;
    } else if (mode === 'merkspiel') {
      systemInstruction += `\n\nMERKSPIEL-MODUS: Das Kind spielt gerade ein Merkspiel und muss sich die Reihenfolge von 5 Gegenständen merken. Feuere seine Merkfähigkeit an!`;
    } else if (mode === 'tetris') {
      systemInstruction += `\n\nTETRIS-MODUS: Der Teenager spielt gerade Tetris. Feuere ihn an, wenn er Zeilen abräumt oder neue Highscores knackt!`;
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
    
    if (subject && mode !== 'homework') {
      systemInstruction += `\nFach: ${subject}.`;
    }
    if (activeTopic) {
      systemInstruction += `\nThema: ${activeTopic}. Hat das Kind das Thema verstanden? ${topicResolved ? 'Ja' : 'Nein'}.`;
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

                if (age === 'speech-delay') {
                  ttsText = ttsText
                    .replace(/\./g, '... ')
                    .replace(/!/g, '!... ')
                    .replace(/\?/g, '?... ')
                    .replace(/,/g, ', ... ');
                }

                const audioUrl = await generateTTS(ttsText, age === 'speech-delay');
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

        if (age === 'speech-delay') {
          ttsText = ttsText
            .replace(/\./g, '... ')
            .replace(/!/g, '!... ')
            .replace(/\?/g, '?... ')
            .replace(/,/g, ', ... ');
        }

        const audioUrl = await generateTTS(ttsText, age === 'speech-delay');
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
  const { text, isSpeechDelay } = req.body;
  if (!text) return res.status(400).json({ error: 'Kein Text.' });
  try {
    let ttsText = text;
    if (isSpeechDelay) {
      ttsText = ttsText
        .replace(/\./g, '... ')
        .replace(/!/g, '!... ')
        .replace(/\?/g, '?... ')
        .replace(/,/g, ', ... ');
    }
    const url = await generateTTS(ttsText, !!isSpeechDelay);
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
  console.log(`\n🚀 KidsBot.ai / Lio Server läuft auf Port ${PORT}`);
});
