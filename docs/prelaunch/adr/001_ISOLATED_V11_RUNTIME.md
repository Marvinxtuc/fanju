# ADR 001: isolated V1.1 local runtime

Status: engineering contract; no policy activation or external signoff.

Use additive V11-prefixed PostgreSQL domain with separate /api/prelaunch/v11 server and V11_* durable handlers. Reuse immutable ChannelReceipt and queue lease primitives; legacy writers do not handle V11 registrations. F and D are independent components; all movement reservations count until channel confirmation. PLATFORM_RETAINED is business disposition, not accounting revenue. Supply, consent, quote and policy references are immutable snapshots. Unresolved effects retain requests and obligations with explicit blocker IDs. Formal policies and all historical WP10-A/A1 bytes stay frozen.

One integration owner controls Schema and lock protocol: Activity -> sorted User -> sorted Registration -> sorted Table -> sorted Receipt -> sorted Component. External channel calls occur outside locks. New V11_* jobs are excluded from legacy worker claims.

Real channels/activation/production are forbidden. All parameter fixtures are TEST_ONLY and cannot be consumed by a production profile. New runtime is exclusively SIMULATION_ONLY behind owned database identity validation.

Migration is additive; after new facts exist use forward repair. Historical migrations are not rewritten. No verified compatible rollback commit exists for this new candidate.
