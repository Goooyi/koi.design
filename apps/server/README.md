# Koi self-hosted server

This service is the bounded, single-user deployment of Koi. It serves the web build on the same
origin when `KOI_STATIC_DIR` is configured, exposes the versioned REST API under `/api/v1`, and
provides authenticated stateless Streamable HTTP MCP for each Document.

## Runtime configuration

- `KOI_AUTH_TOKEN` is required and must contain at least 32 UTF-8 bytes. Every `/api/v1` request
  must send it as `Authorization: Bearer <token>`.
- `KOI_DATA_DIR` defaults to `.koi/server`. Document projections are validated through `@koi/core`
  when loaded. Before first initialization at a newly created path, Koi syncs every new directory
  entry through the pre-existing ancestry. Each replacement syncs its temporary file, renames it
  atomically, and syncs the parent directory where the platform and filesystem support directory
  fsync. A failed directory-entry sync keeps initialization unavailable. If the final sync fails
  after a rename, later reads and writes remain unavailable until Koi can confirm the pending
  directory sync; an exact retry cannot falsely confirm an unproven commit.
- `KOI_STATIC_DIR` optionally points to the built web application.
- `KOI_PUBLIC_ORIGIN` should be set to the external HTTPS origin when a reverse proxy terminates
  TLS. Browser requests carrying a different `Origin` are rejected.
- `HOST` defaults to `127.0.0.1` and `PORT` defaults to `8787`. Bind a public interface only behind
  an HTTPS reverse proxy.

Generate a deployment token with `openssl rand -hex 32`, then start the built service with
`KOI_AUTH_TOKEN=... node dist/main.js`.

From the repository root, the supported container path is `cp .env.example .env`, set the generated
token in `.env`, then run `docker compose up --build`. It binds to `127.0.0.1:8787`, serves the web
build on the same origin, and persists `/data` in a named volume.

## API contract

REST responses are JSON except the revision SSE route. The MCP route follows Streamable HTTP.
Successful routes are:

- `GET /api/v1/session`
- `GET|POST /api/v1/workspaces`
- `GET /api/v1/workspaces/:workspaceId`
- `GET|POST /api/v1/workspaces/:workspaceId/documents`
- `GET /api/v1/documents/:documentId`
- `POST /api/v1/documents/:documentId/commands`, whose body is one raw `@koi/core` Command
- `POST /api/v1/documents/:documentId/import`, whose body carries `commandId`,
  `expectedDocumentId`, `expectedRevision`, and portable `documentJson`. The web app uses this
  explicit route for **Publish this canvas**.
- `GET /api/v1/documents/:documentId/events?after=<cursor>`, an authenticated SSE revision
  wake-up stream
- `POST /api/v1/documents/:documentId/mcp`, the stateless JSON exchange used by official
  Streamable HTTP clients. It advertises five semantic/model-visible Koi tools plus one app-only
  bounded snapshot-transfer tool and serves the self-contained MCP App View. Other methods receive
  `405 Method Not Allowed` with `Allow: POST`.

Document creation, reads, and imports return the full current Projection as
`{ "snapshot": { "projection": ... } }`, including Document, cursor, history, tombstones,
receipts, outbox, and client heads. Command responses return
`{ "receipt": ..., "replayed": boolean, "revision": number, "cursor": number }`. Errors return
`{ "error": { "code": string, "message": string, "details"?: ... }, "requestId": string }`. Use
authenticated streaming `fetch` for the SSE route; browser `EventSource` cannot attach the Bearer
header.

The current Geometry schema accepts `rotation: 0` only. Clients must not send arbitrary rotation
until the mixed DOM/SVG/overlay interaction model supports one shared affine transform.

The endpoint uses the official Web Standard transport with JSON responses and no server-side MCP
sessions. Configure a client with the per-Document URL and the same Bearer token used by the web
app. Each POST accepts exactly one JSON-RPC message; JSON-RPC batch arrays receive
`400 MCP_BATCH_UNSUPPORTED`. Each exchange receives isolated protocol state. Tool commands share
the file repository and publish the same revision wake-ups as REST. Portable imports keep the
hosted Document, Workspace, and History IDs stable, advance Revision, and retain bounded
idempotency receipts across restarts. The single-file View is embedded into the standalone server
artifact at build time.

MCP request bodies are capped at 2 MiB and at most eight exchanges run concurrently. An excess
exchange receives `503 MCP_CAPACITY` with `Retry-After: 1`.

The browser checkpoints a hosted edit and its pending outbox to IndexedDB before REST delivery.
When reconnecting to the same persisted authority, it resends undelivered Commands in history
order, saves each acknowledgement before proceeding, and then reads the current Projection. A
conflict stops replay and leaves that Command and later Commands in the browser outbox. SSE events
remain wake-ups and cannot overwrite a browser Projection while that outbox is non-empty.

## Deliberate bounds

The first self-hosted topology is one process and one writer. It does not provide accounts,
multi-tenant isolation, horizontal replicas, or shared network storage. Use one service instance
per data directory; running multiple writers against the same directory is unsupported.

Current default limits are:

| Boundary                                                                        |            Limit |
| ------------------------------------------------------------------------------- | ---------------: |
| Workspaces                                                                      |               32 |
| Documents across the deployment                                                 |              128 |
| Documents in one Workspace                                                      |               64 |
| Serialized stored Document record, including its Projection and import receipts |            8 MiB |
| Repository index                                                                |            1 MiB |
| Concurrent full-Projection file reads                                           |                2 |
| Pending repository writes                                                       |              128 |
| Undelivered Commands retained by one Projection                                 |               64 |
| Commands retained across one Projection lifetime                                |           50,000 |
| Ordinary REST JSON body                                                         |          512 KiB |
| Document import or hosted MCP JSON body                                         |            2 MiB |
| Portable Document JSON or directly returned MCP Projection                      |  1,000,000 bytes |
| Raw MCP View Projection chunk                                                   |    512,000 bytes |
| Complete paginated MCP View Projection                                          | 32,000,000 bytes |
| Concurrent hosted MCP exchanges                                                 |                8 |
| SSE subscribers                                                                 |               64 |
| Queued revision wake-ups per subscriber                                         |               16 |
| HTTP connections                                                                |                8 |
| Requests per HTTP connection                                                    |                1 |
| HTTP socket inactivity timeout                                                  |       30 seconds |
| Served static file                                                              |           32 MiB |

The 8 MiB stored-Document record is the effective hosted persistence ceiling even though the
shared View transfer protocol can assemble at most 32,000,000 bytes. A Projection above the direct
1,000,000-byte boundary reopens through sequential app-only 512,000-byte raw chunks (at most 63).
Every stateless chunk read recomputes and repeats a SHA-256 fingerprint; a concurrent change fails
with retryable `SNAPSHOT_CHANGED` instead of mixing bytes. Open and import both return either a
direct Projection or this transfer descriptor.

An excess full-Projection read fails with `503 SERVER_BUSY` instead of entering an unbounded
queue. Revision notifications are bounded wake-ups; clients reread the latest full Projection and
must not treat the stream as a durable event log. MCP element inspection accepts at most 32 IDs
per call and truncates deeply nested property previews.

The 50,000-Command history boundary rejects the next mutation without changing the stored
Projection. Importing into that same hosted Document does not compact its history. Create a new
hosted Document and import the portable content there to continue; automatic in-place compaction
is not implemented in this release.

The deployment token is equivalent to administrator access. Do not place it in a URL, commit it,
or expose this service directly over plaintext public HTTP. The Koi web app keeps the entered
token only in page memory. IndexedDB stores the non-secret per-Document authority and hosted base
URL; `sessionStorage` may keep that URL only as a tab-scoped connection-form prefill. Back up the
data volume before server upgrades; automated backup, restore, and schema migration tooling is not
implemented yet.
