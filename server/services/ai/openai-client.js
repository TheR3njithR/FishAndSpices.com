const OPENAI_API_BASE = 'https://api.openai.com/v1';

function requestError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function buildHeaders(apiKey, safetyIdentifier = null) {
  const headers = {
    authorization: `Bearer ${apiKey}`
  };
  if (safetyIdentifier) headers['OpenAI-Safety-Identifier'] = safetyIdentifier;
  return headers;
}

async function parseApiError(response) {
  const fallback = `OpenAI request failed with status ${response.status}.`;
  try {
    const payload = await response.json();
    const detail = payload?.error?.message || payload?.message;
    return detail ? `${fallback} ${detail}` : fallback;
  } catch {
    return fallback;
  }
}

export async function createModelResponse({ apiKey, model, input, tools = [], toolChoice = 'auto', safetyIdentifier = null, metadata = null, signal = null, responseFormat = null }) {
  if (!apiKey) throw requestError('AI service is not configured.', 503);
  const payload = {
    model,
    input,
    tools,
    tool_choice: toolChoice,
    metadata: metadata || undefined
  };
  if (responseFormat) payload.text = { format: responseFormat };
  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      ...buildHeaders(apiKey, safetyIdentifier),
      'content-type': 'application/json'
    },
    signal: signal || undefined,
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw requestError(await parseApiError(response), response.status);
  return response.json();
}

export async function createRealtimeClientSecret({ apiKey, session, safetyIdentifier = null }) {
  if (!apiKey) throw requestError('Realtime service is not configured.', 503);
  const response = await fetch(`${OPENAI_API_BASE}/realtime/client_secrets`, {
    method: 'POST',
    headers: {
      ...buildHeaders(apiKey, safetyIdentifier),
      'content-type': 'application/json'
    },
    body: JSON.stringify({ session })
  });
  if (!response.ok) throw requestError(await parseApiError(response), response.status);
  return response.json();
}

export async function synthesizeSpeechAudio({ apiKey, model, voice, input, instructions = null, responseFormat = 'wav', safetyIdentifier = null }) {
  if (!apiKey) throw requestError('Voice service is not configured.', 503);
  const response = await fetch(`${OPENAI_API_BASE}/audio/speech`, {
    method: 'POST',
    headers: {
      ...buildHeaders(apiKey, safetyIdentifier),
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      voice,
      input,
      instructions: instructions || undefined,
      response_format: responseFormat
    })
  });
  if (!response.ok) throw requestError(await parseApiError(response), response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, responseFormat };
}

export async function transcribeSpeechAudio({ apiKey, model, buffer, mimeType, language = null, safetyIdentifier = null }) {
  if (!apiKey) throw requestError('Voice transcription is not configured.', 503);
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), 'recording.webm');
  if (language) form.append('language', language);
  const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: buildHeaders(apiKey, safetyIdentifier),
    body: form
  });
  if (!response.ok) throw requestError(await parseApiError(response), response.status);
  const result = await response.json();
  return typeof result?.text === 'string' ? result.text.trim() : '';
}
