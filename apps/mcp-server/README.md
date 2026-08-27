# Koi local MCP server

The stdio server persists its current Koi Projection across process restarts. By default it writes
`.koi/mcp/projection.json` relative to the process working directory.

Build `apps/mcp-server/dist/cli.mjs`, then configure an MCP host to launch it with Node. Set
`KOI_MCP_DATA_FILE` to an absolute path, or to a path relative to the server process's working
directory, to use a different file:

```sh
KOI_MCP_DATA_FILE=/srv/koi/local-canvas.json node apps/mcp-server/dist/cli.mjs
```

The file contains one current Projection and the bounded receipts needed to make document imports
idempotent across restarts. Koi validates the full Projection when loading it and enforces an exact
32,000,000-byte persisted-file limit. Before the first write to a newly created path, it syncs
every new directory entry through the pre-existing ancestry. It then syncs the temporary file,
commits with a same-directory atomic rename, and syncs the target's parent directory on platforms
and filesystems that support directory fsync. Invalid or oversized existing data is reported as an
error; Koi does not replace it with the demo Document.

If a new directory-entry sync fails, the first state is not written and later attempts remain
unavailable until that pending sync succeeds. If an atomic rename succeeds but its final directory
sync fails, the mutation reports an unknown outcome. The repository retains that renamed state
internally but does not expose it as authoritative: later reads and exact retries continue failing
until the pending directory sync succeeds.

Mutations are serialized within the server process, with at most four active or waiting mutation
payloads by default. Excess apply and import requests fail immediately as `SERVER_BUSY` with
`retryable: true`; they do not enter the queue or reserve their idempotency keys. Embedders can set
the positive `maxPendingMutations` server option when their resource budget requires a different
finite limit.

Projection reads share that serialized operation stream, with at most four active or waiting reads
by default. Excess open, snapshot-chunk, inspect, and export requests fail before queueing as a
structured `SERVER_BUSY` result with `retryable: true`. Embedders can set the positive
`maxPendingReads` server option to another finite limit.

The shared reducer can retain at most 64 undelivered Commands in a Projection. For this local
authority, a successful atomic file write is delivery: the persisted receipt is marked
`acknowledged` and that Command is removed from the outbox in the same file replacement. Exact
retries still return the durable receipt without committing twice, so the stdio outbox does not
grow during normal operation.

The Projection also retains at most 50,000 Commands across its lifetime. At that boundary, the
next mutation fails with `RESOURCE_LIMIT` without changing the file. Importing into the same file
does not compact its existing history; configure a new `KOI_MCP_DATA_FILE` and import the portable
Document there to continue.

Directories Koi creates use `0700`; the data file and temporary replacement use `0600`. Koi never
changes the mode of a pre-existing configured parent directory, because that directory may be
shared. Secure a custom parent according to your deployment policy.

The server advertises five semantic/model-visible tools plus the app-only
`koi_canvas_read_snapshot_chunk` used by its View. Portable Document JSON and a directly returned
Projection are separately capped at 1,000,000 UTF-8 bytes. A complete Projection above that direct
boundary and at most 32,000,000 bytes reopens through sequential 512,000-byte raw chunks (at most
63); base64 encoding keeps each chunk tool result below the direct boundary. The descriptor and
every stateless chunk read carry a SHA-256 fingerprint, and a changed Projection fails with
retryable `SNAPSHOT_CHANGED` instead of mixing bytes. Open and import both use this
snapshot-or-transfer contract.

Element inspection accepts at most 32 IDs and returns bounded, possibly truncated property
previews. A successful apply whose Projection no longer fits a direct response remains durable;
its tool response omits the snapshot and sets `refreshRequired: true`, after which the View can
reopen through the chunk protocol. The stdio SDK transport rejects and closes on an inbound
JSON-RPC message above 4 MiB, leaving room for protocol framing around Koi's 1,000,000-byte
portable payload limit.

Run only one local stdio server process per data file. Give separate processes separate
`KOI_MCP_DATA_FILE` paths. The authenticated hosted service uses its separate repository and data
directory; it does not share this stdio file.
