-- AI Marketplace Assistant core schema. Additive and backward compatible.

create table if not exists fas_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid references fas_customer_users(id) on delete set null,
  anonymous_token_hash text,
  locale text not null default 'en',
  channel text not null default 'web_text',
  source_domain text,
  source_page text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check (customer_user_id is not null or anonymous_token_hash is not null)
);

create trigger fas_ai_conversations_updated before update on fas_ai_conversations
for each row execute function set_updated_at();

create index if not exists fas_ai_conversations_user_idx
  on fas_ai_conversations (customer_user_id, last_message_at desc)
  where customer_user_id is not null;

create index if not exists fas_ai_conversations_anon_idx
  on fas_ai_conversations (anonymous_token_hash, last_message_at desc)
  where anonymous_token_hash is not null;

create index if not exists fas_ai_conversations_channel_idx
  on fas_ai_conversations (channel, created_at desc);

create table if not exists fas_ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references fas_ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content_text text,
  content_json jsonb,
  language_code text,
  model_name text,
  openai_response_id text,
  created_at timestamptz not null default now(),
  check (content_text is not null or content_json is not null)
);

create index if not exists fas_ai_messages_conversation_idx
  on fas_ai_messages (conversation_id, created_at desc);

create index if not exists fas_ai_messages_openai_response_idx
  on fas_ai_messages (openai_response_id)
  where openai_response_id is not null;

create table if not exists fas_ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references fas_ai_conversations(id) on delete cascade,
  message_id uuid references fas_ai_messages(id) on delete set null,
  tool_name text not null,
  arguments_json jsonb not null,
  result_json jsonb,
  status text not null default 'completed' check (status in ('completed', 'failed', 'rejected')),
  error_code text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists fas_ai_tool_calls_conversation_idx
  on fas_ai_tool_calls (conversation_id, created_at desc);

create index if not exists fas_ai_tool_calls_tool_name_idx
  on fas_ai_tool_calls (tool_name, created_at desc);

create table if not exists fas_ai_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references fas_ai_conversations(id) on delete cascade,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fas_ai_events_type_idx
  on fas_ai_events (event_type, created_at desc);

create index if not exists fas_ai_events_conversation_idx
  on fas_ai_events (conversation_id, created_at desc)
  where conversation_id is not null;
