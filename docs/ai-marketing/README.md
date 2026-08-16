# FishAndSpices AI Marketing OS - Phase 1

Phase 1 adds a simulation-first internal AI workforce to the existing Express/PostgreSQL application. It uses one shared orchestrator, the existing administrator authentication model, the existing database, and one optional Railway worker process.

Implemented agents:

- Marketing Director
- Content Strategist
- Social & Creative Agent
- Marketing Analytics Agent

The founder workspace is `/admin/marketing-ai`. External publication, messaging, advertising, financial actions, and verification changes are not available to agents. Simulation Mode is on by default and is enforced in the tool layer.

Start with [architecture.md](architecture.md), [operations-runbook.md](operations-runbook.md), and [security.md](security.md).
