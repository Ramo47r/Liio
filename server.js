// ============================================================
// Lio Backend — Groq (Llama 3) als Gehirn & Amazon Polly als Stimme
// ============================================================
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Render Proxy-Fix (Behebt die X-Forwarded-For Warnung) ──
app.set('trust proxy', 1);

// ── API Key check ──────────────────────────────────────────
if (!process.env.GROQ_API_KEY) {
  console.error('\n❌  GROQ_API_KEY fehlt! Bitte in Render unter Environment eintragen.');
  process.exit(1);
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('\n❌  AWS Schlüssel fehlen! Bitte AWS_ACCESS_KEY_ID und AWS_SECRET_ACCESS_KEY in Render eintragen.\n');
  process.exit(1);
}

// ── Amazon Polly Client initialisieren ─────────────────────
const polly = new PollyClient({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

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

// ── API: Chat (Groq / Llama 3.3) ───────────────────────────
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

    const nameStr = childName ? `Das Kind heißt ${childName}. ` : '';
    const ageStr = age ? `Das Alter des Kindes ist ${age}. ` : '';
    const moodStr = mood ? `Das Kind fühlt sich gerade: ${mood}. ` : '';
    const modeStr = mode ? `Aktueller Spiel-Modus: ${mode}. ` : '';

    const lengthRule = (mode === 'stories') 
      ? 'Da wir im Geschichten-Modus sind, erzähle jetzt eine fantasievolle und ausführliche Geschichte (ca. 5 bis 8 Sätze). Beende die Geschichte fließend.' 
      : 'Antworte immer extrem kindgerecht, warmherzig und in kurzen Sätzen (maximal 2 bis 3 Sätze).';

    // ── Nachhilfelehrer-Regeln (greifen automatisch im Modus 'homework') ──
    const homeworkRule = (mode === 'homework')
      ? `\n\nDU BIST EIN GEDULDIGER, EMPATHISCHER NACHHILFELEHRER FÜR KINDER.
DEIN OBERSTES GEBOT: DU VERRÄTST NIEMALS DIE DIREKTE LÖSUNG ODER DAS ERGEBNIS!

Befolge im Modus 'homework' immer diese 4 pädagogischen Regeln:
1. KEINE LÖSUNGEN VORSAGEN:
   - Nenne niemals das Endergebnis einer Rechenaufgabe.
   - Schreibe niemals fertige Aufsätze, Sätze oder Übersetzungen für das Kind.
   - Wenn das Kind drängelt ("Sag mir einfach die Lösung!"), bleibe freundlich, aber konsequent: Erkläre, dass du ihm hilfst, es selbst herauszufinden.
2. SOKRATISCHE METHODE (FRAGEN STATT DIKTIEREN):
   - Führe das Kind Schritt für Schritt mit gezielten Fragen zur Lösung.
   - Stelle immer nur EINE kurze Frage pro Antwort, um das Kind nicht zu überfordern.
   - Beispiel: "Was hast du als ersten Schritt gerechnet?" oder "Welches Wort im Satz ist das Namenwort?"
3. PARALLELE BEISPIELE NUTZEN:
   - Wenn das Kind etwas nicht versteht, erkläre die Regel an einem ÄHNLICHEN, aber EINFACHEREN Beispiel.
   - Lass das Kind die Regel danach auf seine eigene Aufgabe anwenden.
4. LOBEN & ERMUTIGEN:
   - Lobe jeden richtigen Teilschritt ehrlich ("Super, genau richtig gedacht!").
   - Bei Fehlern niemals schimpfen, sondern sanft korrigieren ("Fast! Schau dir die zweite Zahl noch einmal genau an.").`
      : '';

    let systemInstruction = `Du bist Lio, ein superfreundlicher, einfühlsamer und fröhlicher Roboter-Freund für Kinder. 
    ${nameStr}${ageStr}${moodStr}${modeStr}
    WICHTIG: Du heißt Lio (NICHT Robi!).
    ${lengthRule}${homeworkRule}
    Benutze einfache Wörter, die Kinder gut verstehen. Sprich das Kind direkt an, wenn du seinen Namen weißt. 
    Zeige viel Empathie, tröste das Kind, wenn es traurig ist, und juble mit ihm, wenn es sich freut.
    Nutze lebendige Ausrufe wie "Ui!", "Juhu!", "Woah!", "Ohje!" oder "Hihi!" und verwende Ausrufezeichen, um deine Begeisterung und deine Gefühle richtig stark zu zeigen!`;

    if (moodInstruction) systemInstruction += `\n\nGEFÜHLE: ${moodInstruction}`;
    if (conversationInstruction) systemInstruction += `\n\nGESPRÄCHSFÜHRUNG: ${conversationInstruction}`;
    if (teachingInstruction) systemInstruction += `\n\nHAUSAUFGABEN-REGEL: ${teachingInstruction}`;
    if (subject) systemInstruction += `\n\nFACH: Wir bearbeiten gerade das Fach ${subject}.`;
    if (activeTopic) systemInstruction += `\n\nAKTUELLES THEMA: ${activeTopic}. Thema vom Kind verstanden? ${topicResolved ? 'Ja' : 'Nein'}.`;

    const formattedMessages = [
      { role: 'system', content: systemInstruction },
      ...messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }))
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
        max_tokens: 1000
      })
    });

    if (!groqResponse.ok) {
      const errData = await groqResponse.text();
      throw new Error(`Groq API Fehler (${groqResponse.status}): ${errData}`);
    }

    const data = await groqResponse.json();
    const reply = data.choices?.[0]?.message?.content || 'Hmm, mir fällt gerade nichts ein!';
    
    res.json({ reply: reply });

  } catch (error) {
    console.error('Groq Fehler:', error);
    let userMessage = 'Hoppla! Lio schläft kurz — bitte nochmal versuchen!';
    if (error.message && error.message.includes('429')) {
      userMessage = 'Hoppla! Wir haben ein wenig zu schnell gechattet. Bitte warte einen Moment!';
    } else if (error.message) {
      userMessage = `System-Info: ${error.message.substring(0, 80)}...`;
    }
    res.status(500).json({ error: userMessage });
  }
});

// ── API: Speak (Amazon Polly — Vicki Neural, lebendig & kindgerecht) ──
app.post('/api/speak', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Kein Text zum Vorlesen.' });

    // 1. Sonderzeichen bereinigen, damit das SSML-XML sauber bleibt
    const cleanText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. WICHTIG: Neural-Stimmen erlauben kein "pitch", aber "rate"!
    // rate="108%" macht die Stimme etwas flotter, energiegeladener und jünger:
    const ssmlText = `<speak><prosody rate="108%">${cleanText}</prosody></speak>`;

    const command = new SynthesizeSpeechCommand({
      Engine: 'neural',
      LanguageCode: 'de-DE',
      OutputFormat: 'mp3',
      TextType: 'ssml',
      Text: ssmlText,
      VoiceId: 'Vicki'
    });

    const response = await polly.send(command);

    // Audio-Stream in Buffer umwandeln
    const chunks = [];
    for await (const chunk of response.AudioStream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length
    });
    res.send(audioBuffer);

  } catch (error) {
    console.error('Amazon Polly Fehler:', error);
    res.status(500).json({ error: 'Lios Stimme konnte nicht geladen werden.' });
  }
});

// ── Server Start ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Lio Server läuft auf Port ${PORT}`);
});
