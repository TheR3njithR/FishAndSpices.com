import { Router } from 'express';
import { customerSessionCookieName } from '../customer-auth-middleware.js';
import { resolveCustomerSession, verifyCustomerCsrf } from '../services/customer-auth.js';
import { consumeRateLimit } from '../services/rate-limit.js';
import { keyedHash, randomToken } from '../security.js';
import {
  appendConversationMessage,
  appendToolCallEvent,
  listConversationMessagesForModel,
  normalizeConversationInput,
  resolveOrCreateConversation
} from '../services/ai/conversation-store.js';
import {
  createModelResponse,
  createRealtimeClientSecret,
  synthesizeSpeechAudio
} from '../services/ai/openai-client.js';
import {
  buildAssistantToolDefinitions,
  executeAssistantToolCall
} from '../services/ai/tool-registry.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function aiError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function aiAnonCookieName(config) {
  return config.isProduction ? '__Host-fas_ai_anon' : 'fas_ai_anon';
}

function aiAnonCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  };
}

function normalizeText(value, { max = 2000, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw aiError('A required field is missing.');
    return null;
  }
  if (typeof value !== 'string') throw aiError('Invalid text input.');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    if (required) throw aiError('A required field is empty.');
    return null;
  }
  if (normalized.length > max) throw aiError('A text field is too long.');
  return normalized;
}

function normalizeModelMessages(messages = []) {
  return messages
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.contentText === 'string')
    .map(item => ({ role: item.role, content: item.contentText }));
}

function extractAssistantText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    const text = item.content
      .filter(content => content?.type === 'output_text' && typeof content.text === 'string')
      .map(content => content.text)
      .join(' ')
      .trim();
    if (text) return text;
  }
  return '';
}

function parseFunctionArguments(argumentsText) {
  if (!argumentsText) return {};
  try {
    const parsed = JSON.parse(argumentsText);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw aiError('The assistant generated malformed function arguments.', 502);
  }
}

function normalizeToolError(error) {
  const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
  if (status === 401) return { errorCode: 'AUTH_REQUIRED', status };
  if (status === 403) return { errorCode: 'FORBIDDEN', status };
  if (status === 404) return { errorCode: 'NOT_FOUND', status };
  if (status === 409) return { errorCode: 'CONFLICT', status };
  if (status === 422 || status === 400) return { errorCode: 'VALIDATION_ERROR', status };
  if (status === 429) return { errorCode: 'RATE_LIMITED', status };
  return { errorCode: 'INTERNAL_ERROR', status };
}

async function resolveActor({ request, pool, config }) {
  const token = request.cookies[customerSessionCookieName(config)];
  if (!token) return { kind: 'anonymous', userId: null, customerSession: null, allowWriteTools: false };
  const customerSession = await resolveCustomerSession({ pool, sessionToken: token, config });
  if (!customerSession) return { kind: 'anonymous', userId: null, customerSession: null, allowWriteTools: false };
  const allowWriteTools = verifyCustomerCsrf(customerSession, request.get('x-csrf-token'));
  return {
    kind: 'authenticated',
    userId: customerSession.userId,
    customerSession,
    allowWriteTools
  };
}

function buildSafetyIdentifier({ actor, anonymousTokenHash, config }) {
  const source = actor.userId ? `user:${actor.userId}` : `anon:${anonymousTokenHash || 'unknown'}`;
  return `fas_${keyedHash(source, config.sessionSecret).slice(0, 48)}`;
}

function buildSystemInstruction({ locale, allowWriteTools }) {
  const localeName = locale === 'ml' ? 'Malayalam' : locale === 'hi' ? 'Hindi' : 'English';
  return [
    'You are the FishAndSpices marketplace assistant.',
    `Respond in ${localeName} unless the user asks for another language.`,
    'Use function tools for factual marketplace data and account actions whenever relevant.',
    allowWriteTools
      ? 'Authenticated write tools are enabled for this turn. Confirm user intent before any write action.'
      : 'Write tools are unavailable in this turn. Provide read-only guidance and ask the user to authenticate with CSRF-enabled session for actions.',
    'Never claim an action is completed unless a tool call result confirms success.'
  ].join(' ');
}

async function enforceRateLimit({ pool, config, scope, identifier }) {
  const outcome = await consumeRateLimit(pool, scope, identifier, config);
  if (!outcome.allowed) {
    const error = aiError('Too many assistant requests. Please retry shortly.', 429);
    error.retryAfterSeconds = outcome.retryAfterSeconds;
    throw error;
  }
}

function validateConversationId(conversationId) {
  if (conversationId === undefined || conversationId === null || conversationId === '') return null;
  if (!UUID.test(String(conversationId))) throw aiError('Invalid conversation identifier.', 400);
  return String(conversationId);
}

export function createAiAssistantRouter({ config, pool, services = {} }) {
  const router = Router();

  const runAssistantTurn = services.runAssistantTurn || (async ({
    actor,
    conversation,
    userMessage,
    locale,
    modelMessages,
    safetyIdentifier
  }) => {
    const tools = buildAssistantToolDefinitions({ allowWrites: actor.allowWriteTools });
    const input = [
      { role: 'developer', content: buildSystemInstruction({ locale, allowWriteTools: actor.allowWriteTools }) },
      ...modelMessages,
      { role: 'user', content: userMessage }
    ];

    let response = null;
    let iterations = 0;
    let toolCallCount = 0;
    while (iterations < config.aiAssistantMaxToolRounds) {
      response = await createModelResponse({
        apiKey: config.openaiApiKey,
        model: config.aiAssistantDefaultModel,
        input,
        tools,
        toolChoice: 'auto',
        safetyIdentifier,
        metadata: {
          source: 'fishandspices-ai-assistant',
          conversation_id: conversation.id,
          actor: actor.kind
        }
      });

      const outputItems = Array.isArray(response.output) ? response.output : [];
      const functionCalls = outputItems.filter(item => item?.type === 'function_call');
      if (!functionCalls.length) break;

      input.push(...outputItems);
      for (const functionCall of functionCalls) {
        const startedAt = Date.now();
        let status = 'completed';
        let errorCode = null;
        let result = null;
        let parsedArguments = {};
        try {
          parsedArguments = parseFunctionArguments(functionCall.arguments);
          result = await executeAssistantToolCall({
            name: functionCall.name,
            args: parsedArguments,
            pool,
            userId: actor.userId
          });
        } catch (error) {
          status = 'failed';
          const normalized = normalizeToolError(error);
          errorCode = normalized.errorCode;
          result = {
            ok: false,
            errorCode: normalized.errorCode,
            message: normalized.status >= 500
              ? 'The action could not be completed right now.'
              : error.message
          };
        }

        toolCallCount += 1;
        await appendToolCallEvent(pool, {
          conversationId: conversation.id,
          toolName: functionCall.name,
          argumentsJson: parsedArguments,
          resultJson: result,
          status,
          errorCode,
          durationMs: Date.now() - startedAt
        });

        input.push({
          type: 'function_call_output',
          call_id: functionCall.call_id,
          output: JSON.stringify(result)
        });
      }
      iterations += 1;
    }

    if (!response) throw aiError('No response generated by assistant.', 502);
    return {
      response,
      assistantText: extractAssistantText(response),
      toolCallCount
    };
  });

  const createRealtimeSession = services.createRealtimeSession || (async ({ safetyIdentifier, instructions = null }) => {
    const payload = {
      type: 'realtime',
      model: config.aiAssistantRealtimeModel,
      audio: {
        output: {
          voice: config.aiAssistantVoice
        }
      },
      instructions: instructions || undefined
    };
    return createRealtimeClientSecret({
      apiKey: config.openaiApiKey,
      session: payload,
      safetyIdentifier
    });
  });

  const synthesizeSpeech = services.synthesizeSpeech || (async ({ text, safetyIdentifier, instructions }) => {
    return synthesizeSpeechAudio({
      apiKey: config.openaiApiKey,
      model: config.aiTtsModel,
      voice: config.aiAssistantVoice,
      input: text,
      instructions,
      responseFormat: 'wav',
      safetyIdentifier
    });
  });

  router.post('/chat', async (request, response, next) => {
    try {
      if (!config.aiAssistantEnabled || config.aiAssistantDefaultMode === 'maintenance') {
        return response.status(503).json({ success: false, error: 'AI assistant is currently unavailable.' });
      }
      if (!config.openaiApiKey) {
        return response.status(503).json({ success: false, error: 'AI assistant is not configured.' });
      }

      const actor = await resolveActor({ request, pool, config });
      const anonymousToken = actor.kind === 'anonymous'
        ? (request.cookies[aiAnonCookieName(config)] || randomToken(24))
        : null;
      if (actor.kind === 'anonymous' && !request.cookies[aiAnonCookieName(config)]) {
        response.cookie(aiAnonCookieName(config), anonymousToken, aiAnonCookieOptions(config));
      }

      const anonymousTokenHash = anonymousToken ? keyedHash(anonymousToken, config.sessionSecret) : null;
      const safetyIdentifier = buildSafetyIdentifier({ actor, anonymousTokenHash, config });

      await enforceRateLimit({
        pool,
        config,
        scope: actor.userId ? 'ai_chat_auth' : 'ai_chat_anon',
        identifier: actor.userId ? `user:${actor.userId}` : `${request.ip || 'unknown'}:${anonymousTokenHash || 'anon'}`
      });

      const userMessage = normalizeText(request.body?.message, { max: 4000, required: true });
      const conversationInput = normalizeConversationInput({
        locale: request.body?.locale,
        channel: request.body?.channel,
        attribution: request.body?.attribution
      });

      const conversation = await resolveOrCreateConversation(pool, {
        conversationId: validateConversationId(request.body?.conversationId),
        customerUserId: actor.userId,
        anonymousTokenHash,
        locale: conversationInput.locale,
        channel: conversationInput.channel,
        attribution: conversationInput.attribution
      });

      await appendConversationMessage(pool, {
        conversationId: conversation.id,
        role: 'user',
        contentText: userMessage,
        languageCode: conversationInput.locale
      });

      const modelMessages = normalizeModelMessages(await listConversationMessagesForModel(pool, {
        conversationId: conversation.id,
        limit: config.aiAssistantHistoryLength
      }));

      const turnResult = await runAssistantTurn({
        actor,
        conversation,
        userMessage,
        locale: conversationInput.locale,
        modelMessages,
        safetyIdentifier
      });

      if (!turnResult.assistantText) {
        throw aiError('Assistant did not return a textual response.', 502);
      }

      await appendConversationMessage(pool, {
        conversationId: conversation.id,
        role: 'assistant',
        contentText: turnResult.assistantText,
        languageCode: conversationInput.locale,
        modelName: config.aiAssistantDefaultModel,
        openaiResponseId: turnResult.response?.id || null
      });

      response.json({
        success: true,
        conversation: {
          id: conversation.id,
          locale: conversationInput.locale,
          channel: conversationInput.channel
        },
        actor: {
          authenticated: Boolean(actor.userId),
          writeToolsEnabled: actor.allowWriteTools
        },
        assistant: {
          message: turnResult.assistantText,
          toolCallCount: turnResult.toolCallCount,
          model: config.aiAssistantDefaultModel
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/realtime/session', async (request, response, next) => {
    try {
      if (!config.aiAssistantEnabled || !config.aiRealtimeEnabled || config.aiAssistantDefaultMode === 'maintenance') {
        return response.status(503).json({ success: false, error: 'Realtime assistant is unavailable.' });
      }
      if (!config.openaiApiKey) {
        return response.status(503).json({ success: false, error: 'Realtime assistant is not configured.' });
      }

      const actor = await resolveActor({ request, pool, config });
      const anonymousToken = actor.kind === 'anonymous'
        ? (request.cookies[aiAnonCookieName(config)] || randomToken(24))
        : null;
      if (actor.kind === 'anonymous' && !request.cookies[aiAnonCookieName(config)]) {
        response.cookie(aiAnonCookieName(config), anonymousToken, aiAnonCookieOptions(config));
      }
      const anonymousTokenHash = anonymousToken ? keyedHash(anonymousToken, config.sessionSecret) : null;
      const safetyIdentifier = buildSafetyIdentifier({ actor, anonymousTokenHash, config });

      await enforceRateLimit({
        pool,
        config,
        scope: 'ai_realtime_session',
        identifier: actor.userId ? `user:${actor.userId}` : `${request.ip || 'unknown'}:${anonymousTokenHash || 'anon'}`
      });

      const instructions = normalizeText(request.body?.instructions, { max: 500, required: false });
      const session = await createRealtimeSession({ safetyIdentifier, instructions });
      response.json({ success: true, session });
    } catch (error) {
      next(error);
    }
  });

  router.post('/voice/speak', async (request, response, next) => {
    try {
      if (!config.aiAssistantEnabled || !config.aiVoiceEnabled || config.aiAssistantDefaultMode === 'maintenance') {
        return response.status(503).json({ success: false, error: 'Voice synthesis is unavailable.' });
      }
      if (!config.openaiApiKey) {
        return response.status(503).json({ success: false, error: 'Voice synthesis is not configured.' });
      }

      const actor = await resolveActor({ request, pool, config });
      const anonymousToken = actor.kind === 'anonymous'
        ? (request.cookies[aiAnonCookieName(config)] || randomToken(24))
        : null;
      if (actor.kind === 'anonymous' && !request.cookies[aiAnonCookieName(config)]) {
        response.cookie(aiAnonCookieName(config), anonymousToken, aiAnonCookieOptions(config));
      }
      const anonymousTokenHash = anonymousToken ? keyedHash(anonymousToken, config.sessionSecret) : null;
      const safetyIdentifier = buildSafetyIdentifier({ actor, anonymousTokenHash, config });

      await enforceRateLimit({
        pool,
        config,
        scope: actor.userId ? 'ai_chat_auth' : 'ai_chat_anon',
        identifier: actor.userId ? `user:${actor.userId}` : `${request.ip || 'unknown'}:${anonymousTokenHash || 'anon'}`
      });

      const text = normalizeText(request.body?.text, { max: 800, required: true });
      const locale = normalizeText(request.body?.locale, { max: 5 }) || 'en';
      const localeInstruction = locale === 'ml'
        ? 'Speak in Malayalam with natural pace and clear pronunciation.'
        : locale === 'hi'
          ? 'Speak in Hindi with natural pace and clear pronunciation.'
          : 'Speak in English with natural pace and clear pronunciation.';

      const audio = await synthesizeSpeech({
        text,
        safetyIdentifier,
        instructions: localeInstruction
      });

      response.json({
        success: true,
        audioBase64: audio.buffer.toString('base64'),
        format: audio.responseFormat,
        mimeType: `audio/${audio.responseFormat}`
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
