# Agents

Agent definitions live in `fas_ai_agents`. Instructions, prompt version, model tier, fallback fields, run/cost limits, allowed tools, denied tools, approval behavior, schedule, and timezone are data rather than scattered prompts.

The Marketing Director reads goals, marketplace metrics, content/campaign performance, and prior reports; it creates plans, specialist tasks, campaign proposals, and approvals. It cannot publish.

The Content Strategist creates persona/funnel/language-aware briefs and drafts. Malayalam instructions require natural Kerala usage and prohibit literal robotic translation.

The Social & Creative Agent produces publication-ready copy and creative/image/video briefs. Its drafts always enter approval; no publishing tool is implemented.

The Analytics Agent produces structured daily/weekly reports. Missing metrics must be `null` and listed as instrumentation gaps. Levels 1-3 business, conversion, and acquisition metrics take precedence over engagement metrics.
