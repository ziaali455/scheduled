exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server misconfigured: missing GEMINI_API_KEY' }),
    }
  }

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    }
  }

  const pastedText = String(payload.text || '').trim()
  if (!pastedText) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing text input' }),
    }
  }

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'Extract one calendar event from this text. Return ONLY JSON with keys: title, description, location, start_iso, end_iso. start_iso and end_iso must be valid ISO datetime strings. If no year is given, use the current year. If no timezone is given, use the current timezone. If no event details are given, return an empty response.\n\nText:\n' +
                    pastedText,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      },
    )

    if (!geminiResponse.ok) {
      const failed = await geminiResponse.json().catch(() => null)
      return {
        statusCode: geminiResponse.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: failed?.error?.message || 'Gemini request failed' }),
      }
    }

    const data = await geminiResponse.json()
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Gemini returned an empty response' }),
      }
    }

    const parsed = JSON.parse(raw)
    if (!parsed?.title || !parsed?.start_iso || !parsed?.end_iso) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Gemini response missing required fields' }),
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Unexpected server error' }),
    }
  }
}
