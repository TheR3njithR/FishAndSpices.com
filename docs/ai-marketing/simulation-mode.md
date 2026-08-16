# Simulation Mode

Launch state:

```text
AI_MARKETING_SIMULATION_MODE=true
AI_EXTERNAL_ACTIONS_ENABLED=false
AI_AUTOPUBLISH_ENABLED=false
```

Simulation Mode permits analysis, reports, tasks, campaign drafts, content drafts, and approval requests. The controlled tool layer blocks external tools even if a prompt requests them or an agent definition is misconfigured to allow them.

Approving content changes its internal status to `APPROVED`; it does not publish. Phase 1 has no publication, messaging, advertising, payout, deployment, or verification tool. Turning AI Marketing off stops worker claims and scheduled execution while preserving all history and dashboards.
