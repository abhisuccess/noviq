const {
  store,
  hash,
  getDeviceId,
  readJson,
  consumePrompt,
  quotaResponse,
  json,
  EFFORT_SETTINGS,
  NOVIQ_SYSTEM_INSTRUCTION,
  DEVELOPER_QUESTION,
  MODEL_QUESTION
} = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const data = JSON.parse(event.body || '{}');
    const userMessage = String(data.message || '').trim();
    const sessionId = String(data.session_id || 'default');
    const deviceId = getDeviceId(event);

    if (!userMessage) return json(400, { error: 'No message provided' });

    const usage = await consumePrompt(deviceId);
    if (!usage.allowed) {
      return json(429, {
        error: 'You have used all 5 prompts for the last 24 hours.',
        quota: quotaResponse(usage.count, usage.resetAt)
      });
    }

    const historyKey = `history-${hash(`${deviceId}:${sessionId}`)}`;
    const history = await readJson(historyKey, []);
    const model = String(data.model || process.env.GEMINI_MODEL || 'gemini-3.6-flash').replace(/^models\//, '');
    const effort = String(data.effort || 'standard').toLowerCase();
    const generationConfig = EFFORT_SETTINGS[effort] || EFFORT_SETTINGS.standard;

    let aiMessage;
    if (DEVELOPER_QUESTION.test(userMessage)) {
      aiMessage = 'I am trained & developed by Noviq AI under supervision of Abhi Success.';
    } else if (MODEL_QUESTION.test(userMessage)) {
      aiMessage = 'Noviq Neo 1.0';
    } else {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) return json(500, { error: 'GEMINI_API_KEY is not configured in Netlify.' });

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [...history, { role: 'user', parts: [{ text: userMessage }] }],
            systemInstruction: { parts: [{ text: NOVIQ_SYSTEM_INSTRUCTION }] },
            generationConfig
          })
        }
      );

      const responseData = await geminiResponse.json();
      if (!geminiResponse.ok) {
        const providerMessage = responseData?.error?.message || 'Gemini request failed.';
        if (geminiResponse.status === 401 || geminiResponse.status === 403) {
          return json(geminiResponse.status, { error: 'Invalid Google AI Studio API key. Check GEMINI_API_KEY in Netlify.' });
        }
        if (geminiResponse.status === 429) {
          return json(429, { error: 'Gemini rate limit exceeded. Please wait a moment and try again.' });
        }
        return json(geminiResponse.status, { error: providerMessage });
      }

      aiMessage = (responseData.candidates || [])
        .flatMap((candidate) => candidate.content?.parts || [])
        .map((part) => part.text || '')
        .join('')
        .trim();

      if (!aiMessage) return json(502, { error: 'Gemini returned an empty response. Please try again.' });
    }

    await store.setJSON(historyKey, [
      ...history,
      { role: 'user', parts: [{ text: userMessage }] },
      { role: 'model', parts: [{ text: aiMessage }] }
    ]);

    return json(200, {
      response: aiMessage,
      session_id: sessionId,
      quota: quotaResponse(usage.count, usage.resetAt)
    });
  } catch (error) {
    console.error(error);
    return json(500, { error: `Error: ${error.message || String(error)}` });
  }
};
