import { Router } from 'express';
import { requireAuthentication, requireCsrf } from '../auth-middleware.js';
import { writeAudit } from '../services/audit.js';
import {
  createCommissionPlan,
  createCommissionRule,
  createManualPayout,
  createPartner,
  getPartnerDetail,
  getPartnerNetworkOverview,
  getPartnerSettings,
  listCommissionPlans,
  listCommissionRules,
  listCommissions,
  listPartnerPayouts,
  listPartners,
  markPayoutStatus,
  regeneratePartnerCode,
  setPartnerSettings,
  updateCommissionPlan,
  updateCommissionRule,
  updateCommissionStatus,
  updatePartner
} from '../services/partner-network.js';

const WRITE_ROLES = new Set(['administrator', 'super_admin']);

function requireWriteRole(request, response, next) {
  if (!WRITE_ROLES.has(request.adminSession.user.role)) {
    return response.status(403).json({ success: false, error: 'Insufficient administrator role.' });
  }
  next();
}

function requireFeatureEnabled(config, response) {
  if (!config.partnerNetworkEnabled) {
    response.status(404).json({ success: false, error: 'Partner network is unavailable.' });
    return false;
  }
  return true;
}

export function createPartnersAdminRouter({ config, pool }) {
  const router = Router();
  router.use(requireAuthentication({ pool, config }));

  router.get('/overview', async (_request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      response.json({ success: true, overview: await getPartnerNetworkOverview(pool) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/settings', async (_request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      response.json({ success: true, settings: await getPartnerSettings(pool) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/settings', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const settings = await setPartnerSettings(pool, {
        updates: request.body,
        adminUserId: request.adminSession.user.id
      });
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_settings_updated',
        entityType: 'partner_settings',
        entityIdentifier: 'global',
        newValues: settings
      });
      response.json({ success: true, settings });
    } catch (error) {
      next(error);
    }
  });

  router.get('/commission-plans', async (_request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      response.json({ success: true, plans: await listCommissionPlans(pool) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/commission-plans', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const plan = await createCommissionPlan(pool, request.body || {});
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_commission_plan_created',
        entityType: 'partner_commission_plan',
        entityIdentifier: plan.id,
        newValues: plan
      });
      response.status(201).json({ success: true, plan });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/commission-plans/:planId', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const plan = await updateCommissionPlan(pool, request.params.planId, request.body || {});
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_commission_plan_updated',
        entityType: 'partner_commission_plan',
        entityIdentifier: plan.id,
        newValues: plan
      });
      response.json({ success: true, plan });
    } catch (error) {
      next(error);
    }
  });

  router.get('/commission-plans/:planId/rules', async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      response.json({ success: true, rules: await listCommissionRules(pool, request.params.planId) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/commission-plans/:planId/rules', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const rule = await createCommissionRule(pool, request.params.planId, request.body || {});
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_commission_rule_created',
        entityType: 'partner_commission_rule',
        entityIdentifier: rule.id,
        newValues: rule
      });
      response.status(201).json({ success: true, rule });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/commission-rules/:ruleId', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const rule = await updateCommissionRule(pool, request.params.ruleId, request.body || {});
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_commission_rule_updated',
        entityType: 'partner_commission_rule',
        entityIdentifier: rule.id,
        newValues: rule
      });
      response.json({ success: true, rule });
    } catch (error) {
      next(error);
    }
  });

  router.get('/commissions', async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const payload = await listCommissions(pool, request.query);
      response.json({ success: true, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/commissions/:commissionId/status', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const commission = await updateCommissionStatus(pool, request.params.commissionId, {
        status: request.body?.status,
        reason: request.body?.reason,
        adminUserId: request.adminSession.user.id
      });
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_commission_status_updated',
        entityType: 'partner_commission',
        entityIdentifier: commission.id,
        newValues: {
          status: commission.status,
          approvedAt: commission.approved_at,
          rejectedAt: commission.rejected_at,
          paidAt: commission.paid_at
        }
      });
      response.json({ success: true, commission });
    } catch (error) {
      next(error);
    }
  });

  router.get('/payouts', async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const payload = await listPartnerPayouts(pool, {
        partnerId: request.query.partnerId || null,
        page: request.query.page,
        pageSize: request.query.pageSize
      });
      response.json({ success: true, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.post('/payouts', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const payout = await createManualPayout(pool, {
        partnerId: request.body?.partnerId,
        paymentMethod: request.body?.paymentMethod,
        notes: request.body?.notes,
        commissionIds: Array.isArray(request.body?.commissionIds) ? request.body.commissionIds : null
      });
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_payout_created',
        entityType: 'partner_payout',
        entityIdentifier: payout.id,
        newValues: payout
      });
      response.status(201).json({ success: true, payout });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/payouts/:payoutId', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const payout = await markPayoutStatus(pool, request.params.payoutId, {
        status: request.body?.status,
        paymentReference: request.body?.paymentReference,
        notes: request.body?.notes
      });
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_payout_status_updated',
        entityType: 'partner_payout',
        entityIdentifier: payout.id,
        newValues: payout
      });
      response.json({ success: true, payout });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const payload = await listPartners(pool, request.query || {});
      response.json({ success: true, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const partner = await createPartner(pool, request.body || {});
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_created',
        entityType: 'partner',
        entityIdentifier: partner.id,
        newValues: partner
      });
      response.status(201).json({ success: true, partner });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/regenerate-code', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const partner = await regeneratePartnerCode(pool, request.params.id);
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_code_regenerated',
        entityType: 'partner',
        entityIdentifier: partner.id,
        newValues: { partnerCode: partner.partnerCode }
      });
      response.json({ success: true, partner });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const detail = await getPartnerDetail(pool, request.params.id, {
        page: request.query.page,
        pageSize: request.query.pageSize
      });
      response.json({ success: true, ...detail });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', requireWriteRole, requireCsrf, async (request, response, next) => {
    try {
      if (!requireFeatureEnabled(config, response)) return;
      const partner = await updatePartner(pool, request.params.id, request.body || {});
      await writeAudit(pool, {
        administratorId: request.adminSession.user.id,
        action: 'partner_updated',
        entityType: 'partner',
        entityIdentifier: partner.id,
        newValues: partner
      });
      response.json({ success: true, partner });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
