// ============================================================
// Lio Backend — Groq (Llama 3.3) als Gehirn & Gemini TTS als Stimme
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

// ── Cache-Ordner für Audio-Dateien anlegen ─────────────────
const CACHE_DIR = path.join(__dirname, 'audio_cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ── API Key Checks ─────────────────────────────────────────
if (!process.env.GROQ_API_KEY) {
  console.error('\n❌  GROQ_API_KEY fehlt! Bitte in Render unter Environment eintragen.');
  process.exit(1);
}

if (!process.env.REPLICATE_API_TOKEN) {
  console.error('\n❌  REPLICATE_API_TOKEN fehlt! Bitte in Render unter Environment eintragen.\n');
  process.exit(1);
}

// ── Replicate Client initialisieren ────────────────────────
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
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

// ── API: Speak (Gemini 3.1 TTS via Replicate + SHA-256 Cache) ──
app.post('/api/speak', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Kein Text zum Vorlesen.' });

    // 1. Lios Charakter & Regieanweisung (Manni-Stil)
    const voice = 'Algenib';
    const prompt = "AUDIO PROFILE: Lio, ein superfreundlicher, empathischer Begleiter für Kinder. DIRECTOR'S NOTES: Eine warme, sanfte und etwas höhere deutsche Männerstimme – wie ein liebevoller großer Bruder. Ruhiges Tempo, fröhlich und mit einem deutlichen Lächeln in der Stimme.";

    // 2. SHA-256 Hash aus Stimme und Text erzeugen
    const hash = crypto
      .createHash('sha256')
      .update(`${voice}_${text.trim()}`)
      .digest('hex');
    
    const cachePath = path.join(CACHE_DIR, `${hash}.wav`);

    // 3. Cache-Prüfung: Bereits vorhandenes Audio direkt ausliefern (0 € Kosten!)
    if (fs.existsSync(cachePath)) {
      const cachedBuffer = fs.readFileSync(cachePath);
      res.set({ 'Content-Type': 'audio/wav', 'Content-Length': cachedBuffer.length });
      return res.send(cachedBuffer);
    }

    // 4. Neu generieren über Replicate (google/gemini-3.1-flash-tts)
    const output = await replicate.run("google/gemini-3.1-flash-tts", {
      input: {
        text: text,
        voice: voice,
        prompt: prompt,
        language_code: "de-DE"
      }
    });

    // 5. Audio-Datei von der Replicate-URL herunterladen & im Cache speichern
    const audioUrl = output.url ? output.url() : output;
    const audioResponse = await fetch(audioUrl);
    const buffer = Buffer.from(await audioResponse.arrayBuffer());
    fs.writeFileSync(cachePath, buffer);

    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': buffer.length });
    res.send(buffer);

  } catch (error) {
    console.error('TTS Fehler:', error);
    res.status(500).json({ error: 'Lios Stimme konnte nicht geladen werden.' });
  }
});

// ── Server Start ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Lio Server läuft auf Port ${PORT}`);
});
