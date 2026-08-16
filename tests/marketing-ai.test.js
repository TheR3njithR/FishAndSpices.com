import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { assertBudgetAvailable, estimateCostAed, getCostStatus, selectModel } from '../server/services/marketing-ai/cost-controls.js';
import { createMockMarketingProvider } from '../server/services/marketing-ai/provider.js';
import { dailyMarketingPlanSchema } from '../server/services/marketing-ai/schemas.js';
import { assertToolAllowed } from '../server/services/marketing-ai/tools.js';

const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:3000', SESSION_SECRET: 'marketing-ai-test-secret' });

describe('AI Marketing fail-safe configuration', () => {
  it('starts in simulation mode with external actions and autopublishing disabled', () => {
    expect(config.aiMarketingEnabled).toBe(true);
    expect(config.aiMarketingSimulationMode).toBe(true);
    expect(config.aiExternalActionsEnabled).toBe(false);
    expect(config.aiAutopublishEnabled).toBe(false);
    expect(config.aiMonthlyBudgetAed).toBe(500);
    expect(config.marketingTimezone).toBe('Asia/Kolkata');
  });

  it('routes model tiers without coupling business logic to one model', () => {
    expect(selectModel(config, { modelTier: 'ECONOMY', preferredModel: null })).toBe(config.aiModelEconomy);
    expect(selectModel(config, { modelTier: 'PREMIUM', preferredModel: 'founder-model' })).toBe('founder-model');
  });
});

describe('AI cost controls', () => {
  it('calculates cached and uncached token costs separately', () => {
    const cost = estimateCostAed({ modelTier: 'STANDARD', inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 100_000 });
    expect(cost).toBeCloseTo(8.73, 6);
  });

  it('returns warning and projection status from ledger totals', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ costToday: 5, costThisMonth: 360 }] }) };
    const status = await getCostStatus(pool, config, new Date('2026-08-16T12:00:00Z'));
    expect(status.level).toBe('WARNING');
    expect(status.remainingBudget).toBe(140);
    expect(status.estimatedEndOfMonthSpend).toBeCloseTo(697.5, 2);
  });

  it('hard-stops ordinary runs before exceeding the global monthly budget', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ costToday: 10, costThisMonth: 495 }] }) };
    const agent = { id: 'agent', name: 'Director', dailyCostLimitAed: 100, monthlyCostLimitAed: 500 };
    await expect(assertBudgetAvailable(pool, config, agent, 10)).rejects.toMatchObject({ code: 'AI_MONTHLY_BUDGET_EXCEEDED', status: 409 });
  });
});

describe('structured output and deterministic provider', () => {
  const validPlan = {
    executionSummary: 'Prioritize verified seller acquisition and real buyer demand.',
    priorities: ['Acquire qualified Kerala sellers'],
    insights: [],
    tasks: [{ title: 'Prepare fish farmer brief', description: '', assignedAgentSlug: 'content-strategist', priority: 'HIGH', input: {} }],
    approvalProposals: []
  };

  it('accepts valid structured plans and rejects malformed plans', () => {
    expect(dailyMarketingPlanSchema.safeParse(validPlan).success).toBe(true);
    expect(dailyMarketingPlanSchema.safeParse({ ...validPlan, tasks: [{ title: 'x', assignedAgentSlug: 'publisher' }] }).success).toBe(false);
  });

  it('returns deterministic mock output without paid API calls', async () => {
    const provider = createMockMarketingProvider({ MARKETING_DIRECTOR: validPlan });
    const first = await provider.generateStructured({ schemaName: 'MARKETING_DIRECTOR' });
    first.output.priorities.push('mutated');
    const second = await provider.generateStructured({ schemaName: 'MARKETING_DIRECTOR' });
    expect(second.output).toEqual(validPlan);
    expect(second.actualCostAed).toBe(0);
  });
});

describe('tool authorization and simulation enforcement', () => {
  it('blocks tools outside an agent allowlist', () => {
    const agent = { name: 'Analytics', allowedTools: ['getMarketplaceMetrics'], deniedTools: ['databaseAdministration'] };
    expect(() => assertToolAllowed({ agent, toolName: 'databaseAdministration', config })).toThrow(/not permitted/);
  });

  it('blocks external actions at the tool layer even if an agent is misconfigured to allow them', () => {
    const agent = { name: 'Social', allowedTools: ['publishContent'], deniedTools: [] };
    expect(() => assertToolAllowed({ agent, toolName: 'publishContent', config })).toThrow(/Simulation Mode/);
  });
});

describe('AI Marketing admin boundary', () => {
  it('rejects unauthenticated access to every internal AI Marketing view', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    const app = createApp({ config, pool });
    await request(app).get('/api/v1/admin/marketing-ai/overview').expect(401);
    await request(app).get('/api/v1/admin/marketing-ai/agents').expect(401);
    await request(app).get('/api/v1/admin/marketing-ai/costs').expect(401);
  });
});