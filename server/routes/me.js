import { Router } from 'express';
import { requireCustomerAuthentication, requireCustomerCsrf } from '../customer-auth-middleware.js';
import { claimHistory } from '../services/customer-auth.js';

const statusLabel = row => {
  if (row.follow_up_status === 'Closed' || row.match_status === 'Closed') return 'Closed';
  if (row.match_status === 'Introduced') return 'Introduced';
  if (row.match_status === 'Potential match') return 'Potential match found';
  if (row.follow_up_status === 'Follow-up due') return 'More information required';
  if (row.follow_up_status === 'Contacted') return 'Under review';
  return row.match_status === 'Not reviewed' ? 'Submitted' : 'Matching in progress';
};

const safeLead = row => ({
  reference: row.public_reference,
  type: row.lead_role === 'buyer' ? 'Buying requirement' : 'Selling offer',
  category: row.category,
  product: row.product,
  quantity: row.quantity,
  unit: row.unit,
  status: statusLabel(row),
  submittedAt: row.submitted_at,
  requestedNextAction: row.follow_up_status === 'Follow-up due' ? 'Provide requested information' : null,
  responsesRequiringAttention: row.follow_up_status === 'Follow-up due'
});

export function createMeRouter({ config, pool }) {
  const router = Router();
  const authenticate = requireCustomerAuthentication({ pool, config });
  router.use(authenticate);

  router.get('/leads', async (request, response, next) => {
    try {
      const result = await pool.query(`select public_reference, lead_role, category, product, quantity, unit,
          verification_status, match_status, follow_up_status, submitted_at
        from leads where customer_user_id = $1 and archived_at is null order by submitted_at desc limit 100`, [request.customerSession.userId]);
      response.json({ success: true, leads: result.rows.map(safeLead) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/leads/:publicReference', async (request, response, next) => {
    try {
      const result = await pool.query(`select public_reference, lead_role, category, product, quantity, unit,
          verification_status, match_status, follow_up_status, submitted_at
        from leads where customer_user_id = $1 and public_reference = $2 and archived_at is null limit 1`, [request.customerSession.userId, request.params.publicReference]);
      if (!result.rowCount) return response.status(404).json({ success: false, error: 'Enquiry not found.' });
      response.json({ success: true, lead: safeLead(result.rows[0]) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/claim-history', requireCustomerCsrf, async (request, response, next) => {
    try {
      const result = await claimHistory({ pool, session: request.customerSession, config });
      response.json({ success: true, linkedRecords: result.linked, claimsNeedingReview: result.review });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
