# Cost Controls

The default global monthly budget is AED 500. The ledger records provider, model, token classes, estimated and actual API costs, tool cost, and agent/run/task/campaign/workflow identifiers.

Thresholds are 70% warning, 90% critical, and 100% hard stop. The orchestrator checks global and per-agent daily/monthly limits before an external AI call. It also reserves the configured maximum run cost, so an ordinary run cannot start if it could cross the budget. Dashboard/report access never depends on budget availability.

Actual provider cost is preferred when supplied. Otherwise the system stores a documented estimate based on model tier and token usage. Model names remain environment-driven; tier pricing is isolated in the cost service and must be reviewed when provider pricing changes.
