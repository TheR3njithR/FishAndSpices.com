import { z } from 'zod';

const taskProposal = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(4000).default(''),
  assignedAgentSlug: z.enum(['marketing-director', 'content-strategist', 'social-creative', 'marketing-analytics']),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  input: z.record(z.string(), z.unknown()).default({})
});

const contentDraft = z.object({
  platform: z.string().min(2).max(80),
  contentType: z.string().min(2).max(80),
  language: z.string().min(2).max(40),
  originalLanguage: z.string().max(40).nullable().default(null),
  languageVariant: z.string().max(80).nullable().default(null),
  persona: z.string().min(2).max(100),
  funnelStage: z.enum(['AWARENESS', 'EDUCATION', 'TRUST', 'CONSIDERATION', 'CONVERSION', 'RETENTION']),
  objective: z.string().min(3).max(500),
  headline: z.string().max(300).nullable().default(null),
  caption: z.string().max(5000).nullable().default(null),
  body: z.string().max(12000).nullable().default(null),
  cta: z.string().max(500).nullable().default(null),
  hashtags: z.array(z.string().max(100)).max(30).default([]),
  creativeBrief: z.string().max(6000).nullable().default(null),
  imagePrompt: z.string().max(6000).nullable().default(null),
  videoScript: z.string().max(12000).nullable().default(null),
  scheduledAt: z.string().datetime().nullable().default(null)
});

const insight = z.object({
  title: z.string().min(3).max(200),
  summary: z.string().min(3).max(3000),
  evidence: z.array(z.string().max(500)).max(12).default([]),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL')
});

export const dailyMarketingPlanSchema = z.object({
  executionSummary: z.string().min(3).max(3000),
  priorities: z.array(z.string().max(500)).max(10),
  insights: z.array(insight).max(12).default([]),
  tasks: z.array(taskProposal).max(20),
  approvalProposals: z.array(z.object({
    category: z.enum(['CONTENT_PUBLICATION', 'CAMPAIGN_CREATION', 'STRATEGY_CHANGE', 'HIGH_COST_AI_RUN', 'EXTERNAL_COMMUNICATION']),
    title: z.string().min(3).max(200),
    summary: z.string().min(3).max(3000),
    reason: z.string().max(2000).default(''),
    riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('LOW'),
    proposedAction: z.record(z.string(), z.unknown())
  })).max(10).default([])
});

export const contentPlanSchema = z.object({
  executionSummary: z.string().min(3).max(3000),
  content: z.array(contentDraft).min(1).max(20),
  tasks: z.array(taskProposal).max(20).default([])
});

export const creativeOutputSchema = z.object({
  executionSummary: z.string().min(3).max(3000),
  content: z.array(contentDraft).min(1).max(12)
});

export const analyticsReportSchema = z.object({
  executionSummary: z.string().min(3).max(3000),
  reportType: z.enum(['DAILY', 'WEEKLY', 'FOUNDER_BRIEF', 'STRATEGY_REVIEW']),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  metrics: z.record(z.string(), z.number().nullable()),
  insights: z.array(insight).max(20),
  recommendations: z.array(z.string().max(1000)).max(20),
  instrumentationGaps: z.array(z.string().max(500)).max(30)
});

export const agentOutputSchemas = {
  MARKETING_DIRECTOR: dailyMarketingPlanSchema,
  CONTENT_STRATEGIST: contentPlanSchema,
  SOCIAL_CREATIVE: creativeOutputSchema,
  MARKETING_ANALYTICS: analyticsReportSchema
};
