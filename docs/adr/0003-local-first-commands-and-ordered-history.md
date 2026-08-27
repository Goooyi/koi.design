# ADR 0003: Use local-first commands and ordered semantic history

- Status: Accepted
- Date: 2026-08-27

## Context

Direct manipulation cannot wait for an SSH or hosted round trip. At the same time, agent layout must not silently overwrite a human move, retries must be safe, and undo must preserve a coherent shared history.

## Decision

Commit each durable human or agent intent atomically to a local Projection and outbox, render it immediately, and synchronize asynchronously. Commands carry document identity, command/client identity, ordering context, origin, bounded operations, and record- or field-level preconditions.

Maintain a server-ordered semantic event stream for canvas data. Use compensating commands for undo. Reserve Yjs for high-contention rich text rather than applying a general CRDT to the whole Page.

Pointer moves and text composition remain transient; a completed drag or meaningful typing group becomes one Command and one undo group.

## Consequences

- Local and standalone use remains responsive and resilient.
- A tool success can promise local durability and read-after-write consistency while honestly reporting remote sync as pending.
- Unrelated edits can merge, while stale geometry/layout fails explicitly and can be replanned.
- Delete wins over stale update, and history never moves backwards.
- The core requires deterministic replay, idempotency, outbox recovery, structured conflict tests, and explicit actor attribution.
