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
app.use(express.urlencoded({ extended: true })); // WICHTIG FÜR DAS LOGIN-FORMULAR

// ════════════════════════════════════════════════════════════
// ── VIP PASSWORT-SCHUTZ FÜR INVESTOREN (Elegantes HTML-Fenster)
// ════════════════════════════════════════════════════════════
app.post('/vip-login', (req, res) => {
  if (req.body.password === 'VIPLIO') {
    // Wenn Passwort stimmt, Cookie für 30 Tage setzen und zur App weiterleiten
    res.setHeader('Set-Cookie', 'lio_vip=1; Path=/; HttpOnly; Max-Age=2592000');
    res.redirect('/');
  } else {
    // Bei falschem Passwort Warnung zeigen und zurück zum Login
    res.send('<script>alert("Falsches Passwort!"); window.location.href="/";</script>');
  }
});

app.use((req, res, next) => {
  const url = req.path;
  // Schütze nur die Hauptseiten und die API (Bilder und CSS dürfen laden)
  if (url === '/' || url === '/index.html' || url === '/en.html' || url.startsWith('/api/')) {
    const cookies = req.headers.cookie || '';
    if (!cookies.includes('lio_vip=1')) {
      // API-Calls ohne Cookie abblocken
      if (url.startsWith('/api/')) {
        return res.status(401).json({ error: 'Nicht autorisiert. Bitte einloggen.' });
      }
      // Für Besucher: Schickes Login-Fenster im KidsBot-Design anzeigen
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

// Den Ordner für alle statischen Dateien (HTML, CSS, JS, Bilder) freigeben
app.use(express.static(__dirname));

// ── ELEVENLABS TURBO TTS ENGINE ──
async function generateTTS(text, isSlow = false, lang = 'de') {
  // ELEVENLABS ABGESCHALTET! 
  // Wir geben 'null' zurück, damit deine App automatisch die kostenlosen Browser-Stimmen nimmt.
  return null;
}

// ── OPTION 2 — PERSONALISIERTER GUTE-NACHT-GESCHICHTEN GENERATOR ──
app.post('/api/generate-story', async (req, res) => {
  try {
    const { hero, companion, theme, setting, isBedtime, age, lang } = req.body;
    const isEn = lang === 'en';

    const heroName = hero || (isEn ? 'Leo' : 'Leo');
    const compName = companion 
      ? (isEn ? `along with best friend ${companion}` : `zusammen mit dem besten Freund ${companion}`) 
      : (isEn ? 'bravely all alone' : 'ganz mutig allein');
    const worldName = setting || (isEn ? 'a magical forest' : 'einem zauberhaften Zauberwald');
    const userTheme = theme || (isEn ? 'a beautiful dream journey' : 'einer wunderbaren Traumreise');

    console.log(`🌙 Generiere Geschichte für ${heroName} (${worldName}, Thema: ${userTheme}, Lang: ${lang})`);

    let storyPrompt = '';
    if (isEn) {
      storyPrompt = `You are a world-class children's author and an expert in child bedtime psychology.
Write a heartwarming, calming read-aloud story for a child named ${heroName}.

PARAMETERS:
- Main Character: ${heroName} ${compName}

- Setting: In ${worldName}

- Core Theme/Experience: ${userTheme}

- Mode: ${isBedtime ? 'Bedtime Story (Sleep-Fade Principle)' : 'Exciting Daytime Adventure'}

- Target Audience: Age-appropriate, warm, and loving


RULES:
1. Length: Exactly 4 to 5 short paragraphs (approx. 220 to 280 words).

2. Start with ${heroName} and their companions curiously entering the setting.
3. The theme (${userTheme}) is addressed gently and comfortingly. Fears or challenges are resolved lovingly.
${isBedtime ? `4. SLEEP-FADE ENDING: The last paragraph must be extremely calm, visual, and sleepy. The world settles down, stars twinkle, a long yawn spreads, and ${heroName} falls asleep peacefully, protected and happy.` : '4. Conclude with a happy, encouraging sense of achievement.'}
5. No stage directions, no asterisks (*yawns*), no headings in the body text. Write pure, perfect read-aloud text.`;
    } else {
      storyPrompt = `Du bist ein weltbester Kinderbuchautor und Experte für kindgerechte Einschlafpsychologie.
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
    }

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

    const title = isEn ? `${heroName} in ${worldName}` : `${heroName} in ${worldName}`;

    let ttsStoryText = storyText
      .replace(/([0-9]+)/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim();

    if (isBedtime) {
      ttsStoryText = ttsStoryText
        .replace(/\./g, '... ')
        .replace(/!/g, '!... ')
        .replace(/\?/g, '?... ')
        .replace(/,/g, ', ... ');
    }

    const audioUrl = await generateTTS(ttsStoryText, isBedtime || age === 'speech-delay', lang);

    res.json({
      success: true,
      title,
      story: storyText,
      audioUrl
    });

  } catch (error) {
    console.error('Fehler bei Geschichten-Generierung:', error.message);
    const errObj = req.body.lang === 'en' 
      ? { error: 'The dream world is still sleeping. Please try again in a moment!' } 
      : { error: 'Die Traumwelt schläft noch. Bitte gleich nochmal probieren!' };
    res.status(500).json(errObj);
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
      age,
      lang
    } = req.body;
    
    const isEn = lang === 'en';

    let systemInstruction = "";
    if (isEn) {
      const nameStr = childName ? `The child's name is ${childName}. (IMPORTANT: Use the name VERY RARELY, not in every sentence!) ` : '';
      const modeStr = mode ? `Current mode: ${mode}. ` : '';

      systemInstruction = `You are Lio, the child's best and most loyal friend. 
IMPORTANT: Always answer in a warm, direct, and friendly tone using very short sentences. Use simple words. ${nameStr}${modeStr}

LANGUAGE: Speak in English! Write numbers as normal digits (1, 2, 3). 

EMPATHY & TRUST: If the child is sad, angry, scared, or sick, be their best friend. Comfort them, listen actively, and take their feelings seriously. 

ACTIVE MEMORY: If the child told you about a problem or worry earlier, ask about it lovingly later on your own.`;

      if (age === 'speech-delay') {
        systemInstruction += `\n\nSPECIAL CATEGORY: SPEECH DELAY (MAXIMUM EMPATHY & PATIENCE):
1. The child may have a speech delay or is just learning to speak. Be the most patient, loving companion in the world.

2. If the child only says single words or incomplete sentences, be extremely happy about every attempt!
3. NEVER directly correct the child for mistakes. Lovingly repeat the child's thought as a complete, simple sentence (e.g. "Yes, great! The dog is running there!").
4. Always answer in only 1 to a maximum of 2 short sentences.
5. Gently encourage the child constantly ("You are doing great!", "I love listening to you!").`;
      }

      if (emotion && emotion !== 'normal') {
        systemInstruction += `\n\nNote: The child is currently feeling ${emotion}. Respond lovingly immediately and comfort them.`;
      } else if (mood) {
        systemInstruction += `\n\nChild's mood today: ${mood}.`;
      }
      
      if (mode === 'stories') {
        systemInstruction += `\n\nSTORY MODE: The child wants a story. Encourage them to open the magical Story Wizard!`;
      } else if (mode === 'memory') {
        systemInstruction += `\n\nMEMORY MODE: The child is currently playing a matching game. Cheer them on!`;
      } else if (mode === 'zeigauf') {
        systemInstruction += `\n\nPOINT & FIND MODE: The child is playing a picture finding game. Praise them warmly for correct answers!`;
      } else if (mode === 'merkspiel') {
        systemInstruction += `\n\nSEQUENCE MODE: The child is playing a memory sequence game. Encourage their memory skills!`;
      } else if (mode === 'tetris') {
        systemInstruction += `\n\nTETRIS MODE: The teen is playing Tetris. Cheer them on when they clear lines!`;
      } else if (mode === 'homework') {
        systemInstruction += `\n\nHOMEWORK HELP: You are a Socratic learning coach. 
CRITICAL RULES:
1. NO SPOILERS: NEVER give away the direct solution or final answer! Guide the child step-by-step with questions.

2. STRICT CHECKING: Read the child's answers VERY CAREFULLY. If the child writes nonsense, guesses wildly, or the answer is wrong, DO NOT PRAISE THEM! Never say "Good job" to a wrong answer. Say friendly: "That is not quite right yet." and give a new small hint.`;

        if (subject === 'math') {
          systemInstruction += `\nSUBJECT MATH: Use small thought experiments (gummy bears, apples) to explain calculations.`;
        } else if (subject === 'english') {
          systemInstruction += `\nSUBJECT ENGLISH/READING: Pay close attention to spelling! If a word is wrong, don't correct it immediately, but give a hint like the first letter.`;
        }
      }
      
      if (subject && mode !== 'homework') {
        systemInstruction += `\nSubject: ${subject}.`;
      }
      if (activeTopic) {
        systemInstruction += `\nTopic: ${activeTopic}. Has the child understood the topic? ${topicResolved ? 'Yes' : 'No'}.`;
      }

    } else {
      // DEUTSCHER PROMPT
      const nameStr = childName ? `Das Kind heißt ${childName}. (WICHTIG: Nutze den Namen nur GANZ SELTEN, nicht in jedem Satz!) ` : '';
      const modeStr = mode ? `Aktueller Modus: ${mode}. ` : '';

      systemInstruction = `Du bist Lio, der beste und loyalste Freund des Kindes. 
WICHTIG: Antworte immer warmherzig, direkt und kumpelhaft in sehr kurzen Sätzen. Nutze einfache Wörter. ${nameStr}${modeStr}

SPRACHE: Sprich auf Deutsch! WICHTIGE AUSNAHME: Wenn ihr Englisch lernt, darfst du englische Vokabeln verwenden. Schreibe Zahlen als ganz normale Ziffern (1, 2, 3). 

EMPATHIE & VERTRAUEN: Wenn das Kind traurig, wütend, ängstlich oder krank ist, sei der beste Freund. Tröste es, höre aktiv zu und nimm seine Gefühle ernst. 

AKTIVES GEDÄCHTNIS: Wenn das Kind dir früher von einem Problem oder einer Sorge erzählt hat, frage später von dir aus liebevoll nach.`;

      if (age === 'speech-delay') {
        systemInstruction += `\n\nBESONDERE KATEGORIE: SPRACHFÖRDERUNG & SPRACHVERZÖGERUNG (MAXIMALE EMPATHIE & GEDULD):
1. Das Kind hat möglicherweise eine Sprachverzögerung oder lernt gerade erst sprechen. Sei der geduldigste, liebevollste Begleiter der Welt.

2. Wenn das Kind nur einzelne Wörter, Laute oder unvollständige Sätze sagt, freue dich riesig über jeden Sprechversuch!
3. Korrigiere das Kind NIEMALS direkt für Fehler. Wiederhole den Gedanken des Kindes liebevoll als vollständigen, einfachen Satz.
4. Antworte immer in nur 1 bis maximal 2 kurzen Sätzen. Sprich in einfachen, warmherzigen Worten.
5. Ermutige das Kind ständig sanft ("Du machst das prima!", "Ich freue mich, dir zuzuhören!").`;
      }

      if (emotion && emotion !== 'normal') {
        systemInstruction += `\n\nHinweis: Das Kind fühlt sich gerade ${emotion}. Gehe sofort liebevoll darauf ein und tröste es.`;
      } else if (mood) {
        systemInstruction += `\n\nStimmung des Kindes heute: ${mood}.`;
      }
      
      if (mode === 'stories') systemInstruction += `\n\nGESCHICHTEN-MODUS: Das Kind wünscht sich eine Geschichte. Ermutige es, den magischen Geschichten-Zauberer zu öffnen!`;
      else if (mode === 'memory') systemInstruction += `\n\nMEMORY-MODUS: Das Kind spielt gerade auf dem Bildschirm Memory mit Tieren und Fahrzeugen. Feuere es an!`;
      else if (mode === 'zeigauf') systemInstruction += `\n\nZEIG-AUF-MODUS: Das Kind spielt gerade das Bildersuchspiel 'Zeig auf!'. Lobe es herzlich für richtige Treffer!`;
      else if (mode === 'merkspiel') systemInstruction += `\n\nMERKSPIEL-MODUS: Das Kind spielt gerade ein Merkspiel und muss sich die Reihenfolge von 5 Gegenständen merken. Feuere seine Merkfähigkeit an!`;
      else if (mode === 'tetris') systemInstruction += `\n\nTETRIS-MODUS: Der Teenager spielt gerade Tetris. Feuere ihn an, wenn er Zeilen abräumt!`;
      else if (mode === 'homework') {
        systemInstruction += `\n\nHAUSAUFGABEN-HILFE: Du bist ein Lern-Coach. 
WICHTIGE REGELN:
1. LÖSUNGS-VERBOT: Verrate NIEMALS direkt die Lösung oder das Endergebnis! Führe das Kind Schritt für Schritt dorthin.

2. STRENGE PRÜFUNG: Lese die Antworten des Kindes GANZ GENAU. Wenn das Kind Quatsch schreibt, wild rät oder die Vokabel/Aufgabe falsch ist, LOBE ES NICHT! Sag freundlich: "Das stimmt leider noch nicht ganz." und gib einen neuen kleinen Tipp.`;

        if (subject === 'mathe') systemInstruction += `\nFACH MATHE: Nutze kleine Gedankenexperimente (Gummibärchen, Äpfel) zum Erklären.`;
        else if (subject === 'englisch') systemInstruction += `\nFACH ENGLISCH: Achte ganz genau auf die richtige Vokabel und Rechtschreibung! Gib als Tipp z.B. den Anfangsbuchstaben.`;
      }
      
      if (subject && mode !== 'homework') systemInstruction += `\nFach: ${subject}.`;
      if (activeTopic) systemInstruction += `\nThema: ${activeTopic}. Hat das Kind das Thema verstanden? ${topicResolved ? 'Ja' : 'Nein'}.`;
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
                  .replace(/\+/g, isEn ? ' plus ' : ' plus ')
                  .replace(/\=/g, isEn ? ' equals ' : ' ist gleich ')
                  .replace(/\*/g, isEn ? ' times ' : ' mal ')
                  .replace(/\s+/g, ' ')
                  .trim();

                if (age === 'speech-delay') {
                  ttsText = ttsText
                    .replace(/\./g, '... ')
                    .replace(/!/g, '!... ')
                    .replace(/\?/g, '?... ')
                    .replace(/,/g, ', ... ');
                }

                const audioUrl = await generateTTS(ttsText, age === 'speech-delay', lang);
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
          .replace(/\+/g, isEn ? ' plus ' : ' plus ')
          .replace(/\=/g, isEn ? ' equals ' : ' ist gleich ')
          .replace(/\*/g, isEn ? ' times ' : ' mal ')
          .replace(/\s+/g, ' ')
          .trim();

        if (age === 'speech-delay') {
          ttsText = ttsText
            .replace(/\./g, '... ')
            .replace(/!/g, '!... ')
            .replace(/\?/g, '?... ')
            .replace(/,/g, ', ... ');
        }

        const audioUrl = await generateTTS(ttsText, age === 'speech-delay', lang);
        res.write(`data: ${JSON.stringify({ text: cleanSentence, audio: audioUrl })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Streaming Fehler:', error.message);
    const errObj = req.body.lang === 'en' 
      ? '{"error": "Lio fell asleep for a second!"}' 
      : '{"error": "Lio ist kurz eingeschlafen!"}';
    res.write(`data: ${errObj}\n\n`);
    res.end();
  }
});

app.post('/api/speak', async (req, res) => {
  const { text, isSpeechDelay, lang } = req.body;
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
    const url = await generateTTS(ttsText, !!isSpeechDelay, lang);
    
    // NEU: Wenn ElevenLabs aus ist (url ist null), schicken wir einen absichtlichen 
    // 404-Fehler. Deine Frontend-App fängt das ab und lädt sofort die Gratis-Stimme!
    if (!url) {
      return res.status(404).json({ error: 'ElevenLabs ist deaktiviert, nutze lokales TTS.' });
    }
    
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
