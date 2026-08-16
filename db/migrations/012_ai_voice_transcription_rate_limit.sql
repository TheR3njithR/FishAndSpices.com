-- Allow the bounded AI voice transcription endpoint to use the shared rate-limit bucket.

alter table rate_limit_buckets drop constraint if exists rate_limit_buckets_scope_check;
alter table rate_limit_buckets add constraint rate_limit_buckets_scope_check check (scope in (
  'lead_submission', 'admin_login', 'ai_chat_anon', 'ai_chat_auth', 'ai_voice_transcription', 'ai_realtime_session',
  'partner_application', 'partner_referral_capture', 'partner_campaign_create', 'partner_payout_request',
  'marketing_ai_manual_run', 'marketing_ai_approval_action', 'marketing_ai_scheduler'
));