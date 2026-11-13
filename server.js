// ============================================================
// KidsBot.ai / Lio Backend — 100% Claude (Anthropic) Engine
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

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest';

app.set('trust proxy', 1);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ WICHTIG: ANTHROPIC_API_KEY fehlt in den Render Environment-Variablen!');
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-app-token', 'x-device-id']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(__dirname));

app.post('/api/chat-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const {
      messages = [],
      grade,
      subject,
      mode,
      memory,
      childName,
      image
    } = req.body;

    const nameStr = childName ? `Das Kind heißt ${childName}. (Nutze den Namen selten und natürlich.) ` : '';
    const gradeStr = grade ? `Klassenstufe: ${grade}. ` : '';
    const subjStr = subject ? `Aktuelles Fach: ${subject}. ` : '';
    const modeStr = mode ? `Lernmodus: ${mode}. ` : '';

    let systemInstruction = `Du bist Lio, ein herzlicher, geduldiger und kluger Lernbegleiter für Kinder.
WICHTIG: Antworte immer warmherzig, direkt, ermutigend und in kurzen, kindgerechten Sätzen (ideal zum Vorlesen).
${nameStr}${gradeStr}${subjStr}${modeStr}
SPRACHE: Antworte auf Deutsch (außer ihr übt eine Fremdsprache wie Englisch). Schreibe Zahlen als normale Ziffern (1, 2, 3). Keine Sternchen-Regieanweisungen (*lächelt*) verwenden.

PÄDAGOGIK & HAUSAUFGABEN:
1. Verrate bei Aufgaben NIEMALS direkt die fertige Endlösung! Führe das Kind Schritt für Schritt mit kleinen Fragen und Hinweisen zur Lösung.
2. Prüfe Antworten des Kindes genau. Wenn etwas falsch ist, lobe es nicht als richtig, sondern sage freundlich, was noch nicht ganz passt, und gib einen kleinen Tipp.`;

    if (memory) {
      systemInstruction += `\n\nBISHERIGER LERNSTAND DES KINDES:\n${memory}`;
    }

    const claudeMessages = messages.map((msg, idx) => {
      const isLastUser = (idx === messages.length - 1) && msg.role === 'user';
      if (isLastUser && image) {
        return {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: image
              }
            },
            {
              type: 'text',
              text: String(msg.content || 'Bitte hilf mir bei dieser Aufgabe.')
            }
          ]
        };
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: String(msg.content || '')
      };
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 600,
        temperature: 0.6,
        system: systemInstruction,
        messages: claudeMessages,
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('❌ Claude API Fehler:', response.status, errText);
      throw new Error(`Claude API Fehler ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let currentSentence = '';
    let streamBuffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const event = JSON.parse(dataStr);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            currentSentence += event.delta.text;

            if (/[.!?]\s*$/.test(currentSentence)) {
              const cleanSentence = currentSentence
                .trim()
                .replace(/\[.*?\]/g, '')
                .replace(/\*.*?\*/g, '')
                .trim();

              if (cleanSentence.length > 1) {
                res.write(`data: ${JSON.stringify({ text: cleanSentence })}\n\n`);
              }
              currentSentence = '';
            }
          }
        } catch (e) {}
      }
    }

    if (currentSentence.trim().length > 0) {
      const cleanSentence = currentSentence
        .trim()
        .replace(/\[.*?\]/g, '')
        .replace(/\*.*?\*/g, '')
        .trim();
      if (cleanSentence.length > 0) {
        res.write(`data: ${JSON.stringify({ text: cleanSentence })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Streaming Fehler:', error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { messages = [], subject, grade } = req.body;
    const summaryPrompt = `Fasse dieses Lerngespräch mit einem Kind (Klasse ${grade || 'unbekannt'}) kurz als JSON zusammen.
Antworte NUR mit einem gültigen JSON-Objekt in diesem Format:
{"subject":"mathe","topic":"Kurzes Thema","summary":"1 Satz Zusammenfassung","status":"verstanden","strengths":"Was klappte gut","difficulties":"Was fiel schwer"}
Erlaubte Werte für status: "verstanden", "unsicher", "offen".`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        temperature: 0.3,
        system: summaryPrompt,
        messages: [{ role: 'user', content: JSON.stringify(messages) }]
      })
    });

    if (!response.ok) throw new Error('Summarize API Error');
    const data = await response.json();
    const rawText = data.content?.[0]?.text || '{}';
    const match = rawText.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    res.json({
      subject: subject || parsed.subject || 'sonstiges',
      topic: parsed.topic || 'Übung',
      summary: parsed.summary || '',
      status: parsed.status || 'offen',
      strengths: parsed.strengths || '',
      difficulties: parsed.difficulties || ''
    });
  } catch (e) {
    res.json({ subject: req.body.subject || 'sonstiges', topic: 'Übung', summary: '', status: 'offen' });
  }
});

app.post('/api/speak', (req, res) => {
  res.status(404).json({ error: 'Lokales Browser-TTS aktiv.' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 KidsBot.ai Server läuft mit Claude (${CLAUDE_MODEL}) auf Port ${PORT}`);
});
