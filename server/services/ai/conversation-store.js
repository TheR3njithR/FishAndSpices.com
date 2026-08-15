const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LOCALE = 'en';
const ALLOWED_LOCALES = new Set(['en', 'ml', 'hi']);

function requestError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeText(value, { max = 200, nullable = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw requestError('A required field is missing.');
  }
  if (typeof value !== 'string') throw requestError('Invalid text input.');
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    if (nullable) return null;
    throw requestError('A required field is empty.');
  }
  if (normalized.length > max) throw requestError('A text field is too long.');
  return normalized;
}

function normalizeLocale(value) {
  const locale = (typeof value === 'string' ? value.toLowerCase().trim() : '') || DEFAULT_LOCALE;
  return ALLOWED_LOCALES.has(locale) ? locale : DEFAULT_LOCALE;
}

function normalizeAttribution(attribution = {}) {
  return {
    sourceDomain: normalizeText(attribution.sourceDomain, { max: 120 }),
    sourcePage: normalizeText(attribution.sourcePage, { max: 240 }),
    referrer: normalizeText(attribution.referrer, { max: 240 }),
    utmSource: normalizeText(attribution.utmSource, { max: 120 }),
    utmMedium: normalizeText(attribution.utmMedium, { max: 120 }),
    utmCampaign: normalizeText(attribution.utmCampaign, { max: 160 }),
    utmTerm: normalizeText(attribution.utmTerm, { max: 160 }),
    utmContent: normalizeText(attribution.utmContent, { max: 160 })
  };
}

export function normalizeConversationInput({ locale, channel, attribution }) {
  return {
    locale: normalizeLocale(locale),
    channel: normalizeText(channel, { max: 40 }) || 'web_text',
    attribution: normalizeAttribution(attribution || {})
  };
}

export async function resolveOrCreateConversation(pool, { conversationId, customerUserId, anonymousTokenHash, locale, channel, attribution }) {
  if (!customerUserId && !anonymousTokenHash) {
    throw requestError('Conversation actor identity is required.', 400);
  }

  if (conversationId !== undefined && conversationId !== null && conversationId !== '') {
    if (!UUID.test(String(conversationId))) throw requestError('Invalid conversation identifier.', 400);
    const existing = await pool.query(`
      select id, customer_user_id as "customerUserId", anonymous_token_hash as "anonymousTokenHash",
        locale, channel, source_domain as "sourceDomain", source_page as "sourcePage"
      from fas_ai_conversations
      where id = $1
        and (
          ($2::uuid is not null and customer_user_id = $2::uuid)
          or ($2::uuid is null and anonymous_token_hash = $3)
        )
      limit 1
    `, [conversationId, customerUserId || null, customerUserId ? null : anonymousTokenHash]);
    if (!existing.rowCount) throw requestError('Conversation not found.', 404);
    await pool.query('update fas_ai_conversations set last_message_at = now() where id = $1', [conversationId]);
    return existing.rows[0];
  }

  const created = await pool.query(`
    insert into fas_ai_conversations (
      customer_user_id, anonymous_token_hash, locale, channel,
      source_domain, source_page, referrer,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      last_message_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
    returning id, customer_user_id as "customerUserId", anonymous_token_hash as "anonymousTokenHash",
      locale, channel, source_domain as "sourceDomain", source_page as "sourcePage"
  `, [
    customerUserId || null,
    customerUserId ? null : anonymousTokenHash,
    locale,
    channel,
    attribution.sourceDomain,
    attribution.sourcePage,
    attribution.referrer,
    attribution.utmSource,
    attribution.utmMedium,
    attribution.utmCampaign,
    attribution.utmTerm,
    attribution.utmContent
  ]);
  return created.rows[0];
}

export async function appendConversationMessage(pool, {
  conversationId,
  role,
  contentText,
  contentJson = null,
  languageCode = null,
  modelName = null,
  openaiResponseId = null
}) {
  const inserted = await pool.query(`
    insert into fas_ai_messages (
      conversation_id, role, content_text, content_json, language_code, model_name, openai_response_id
    ) values ($1,$2,$3,$4,$5,$6,$7)
    returning id, conversation_id as "conversationId", role, content_text as "contentText", created_at as "createdAt"
  `, [
    conversationId,
    role,
    contentText,
    contentJson,
    languageCode,
    modelName,
    openaiResponseId
  ]);
  await pool.query('update fas_ai_conversations set last_message_at = now() where id = $1', [conversationId]);
  return inserted.rows[0];
}

export async function listConversationMessagesForModel(pool, { conversationId, limit = 16 }) {
  const safeLimit = Math.max(1, Math.min(Math.trunc(Number(limit) || 16), 50));
  const result = await pool.query(`
    select role, content_text as "contentText"
    from fas_ai_messages
    where conversation_id = $1
      and role in ('user', 'assistant')
      and content_text is not null
    order by created_at desc
    limit $2
  `, [conversationId, safeLimit]);
  return result.rows.reverse();
}

export async function appendToolCallEvent(pool, {
  conversationId,
  messageId = null,
  toolName,
  argumentsJson,
  resultJson,
  status,
  errorCode = null,
  durationMs = null
}) {
  await pool.query(`
    insert into fas_ai_tool_calls (
      conversation_id, message_id, tool_name, arguments_json, result_json, status, error_code, duration_ms
    ) values ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [
    conversationId,
    messageId,
    toolName,
    argumentsJson,
    resultJson,
    status,
    errorCode,
    durationMs
  ]);
}
