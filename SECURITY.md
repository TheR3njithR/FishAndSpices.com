# Security policy

## Reporting a vulnerability

Do not open a public issue or include exploit details, credentials, private lead data, precise locations or personal information in a public channel.

Report suspected vulnerabilities privately to the project owner using an agreed encrypted channel. Include:

- affected release revision and environment;
- endpoint, role and prerequisites;
- reproducible steps or a minimal proof of concept;
- observed and expected behavior;
- impact and suggested severity;
- whether any real data was accessed or changed.

Use only agency-provided test accounts and synthetic records. Stop testing and notify the owner immediately if testing reaches production data, infrastructure outside the agreed scope, destructive behavior, denial of service, secrets or another customer's records.

## Coordinated handling

The owner should acknowledge a report, assign a severity and owner, preserve evidence, rotate affected credentials when necessary, remediate on a branch, deploy to staging, and arrange a retest before production promotion. Public disclosure requires written agreement after remediation.

## Supported version

Only the exact release revision identified in the current production-readiness record is supported. Uncommitted working trees and older Railway deployments are not valid audit targets.