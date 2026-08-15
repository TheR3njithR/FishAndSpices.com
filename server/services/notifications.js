export async function notifyAdministrator({ pool, leadId, reference, role, category, config, fetcher = fetch }) {
  if (!config.adminNotificationEmail || !config.emailProvider) {
    await pool.query(`insert into notification_deliveries (lead_id, channel, provider, status)
      values ($1, 'email', null, 'not_configured')`, [leadId]);
    return;
  }

  if (config.emailProvider !== 'resend' || !config.resendApiKey || !config.emailFrom) {
    await pool.query(`insert into notification_deliveries (lead_id, channel, provider, status, last_error_code)
      values ($1, 'email', $2, 'failed', 'provider_configuration_missing')`, [leadId, config.emailProvider]);
    return;
  }

  const delivery = await pool.query(`insert into notification_deliveries (lead_id, channel, provider, status, attempt_count)
    values ($1, 'email', 'resend', 'pending', 1) returning id`, [leadId]);
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [config.adminNotificationEmail],
        subject: `New ${role} ${category} lead ${reference}`,
        text: `A new ${role} ${category} lead was stored successfully. Reference: ${reference}. Sign in to the administrator dashboard to review it.`
      }),
      signal: AbortSignal.timeout(8_000)
    });
    await pool.query(`update notification_deliveries set status = $1, last_error_code = $2 where id = $3`, [response.ok ? 'sent' : 'failed', response.ok ? null : `http_${response.status}`, delivery.rows[0].id]);
  } catch {
    await pool.query(`update notification_deliveries set status = 'failed', last_error_code = 'network_error' where id = $1`, [delivery.rows[0].id]);
  }
}
