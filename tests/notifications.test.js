import { describe, expect, it, vi } from 'vitest';
import { notifyAdministrator } from '../server/services/notifications.js';

describe('administrator notifications', () => {
  it('uses validated configuration instead of ambient environment values', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'delivery-1' }] })
        .mockResolvedValueOnce({ rows: [] })
    };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const config = {
      adminNotificationEmail: 'operations@example.invalid',
      emailProvider: 'resend',
      resendApiKey: 'configured-test-key',
      emailFrom: 'Fish & Spices <notifications@example.invalid>'
    };

    await notifyAdministrator({
      pool,
      leadId: 'lead-1',
      reference: 'FAS-B-20260815-TEST0001',
      role: 'buyer',
      category: 'fish',
      config,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [, request] = fetcher.mock.calls[0];
    expect(request.headers.authorization).toBe('Bearer configured-test-key');
    expect(JSON.parse(request.body)).toMatchObject({
      from: config.emailFrom,
      to: [config.adminNotificationEmail]
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('update notification_deliveries'),
      ['sent', null, 'delivery-1']
    );
  });
});