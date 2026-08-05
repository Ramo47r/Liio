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
