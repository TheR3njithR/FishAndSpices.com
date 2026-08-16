# Permissions

The Phase 1 implementation maps permissions onto existing administrator roles:

| Capability | reviewer | administrator | super_admin |
| --- | --- | --- | --- |
| View dashboards, content, runs, costs | Yes | Yes | Yes |
| Run/pause agents, create goals/campaigns | No | Yes | Yes |
| Approve/reject/request changes | No | Yes | Yes |
| Master kill switch/settings | No | No | Yes |

All mutation endpoints require an authenticated administrator session and CSRF token. Persistent rate limits cover manual runs, approvals, and scheduler operations. Sellers, buyers, partners, and anonymous visitors have no route to the subsystem.

Tool permissions are independently enforced per agent. Prompt text cannot grant a tool. Database administration, publishing, user messaging, spending, and verification changes are denied.
