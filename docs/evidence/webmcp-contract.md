# WebMCP contract evidence

The web application exposes exactly eight top-level tools through
`document.modelContext.registerTool()`. The checked machine-readable result is generated from the
built application, not copied from a separate hand-maintained list:

```sh
pnpm webmcp:manifest
```

The capture command serves `apps/web/dist` on a loopback-only origin, installs a minimal
`document.modelContext` registration recorder before application code runs, waits for all live
registrations, and writes only their public names, descriptions, and input schemas to
`webmcp-tools.json`. Native browser discovery remains a separate deployment gate because a recorder
can prove Koi's live registration path but cannot prove a host's WebMCP implementation.

## Verified contract

- Tool names use only ASCII alphanumerics, `_`, `-`, and `.`, and remain within the current
  1–128-character WebMCP limit.
- All schemas are JSON Schema Draft 2020-12 objects. Fixed objects reject unknown properties;
  strings, numbers, arrays, maps, batch sizes, coordinates, dimensions, versions, JSON depth, and
  JSON collection sizes are bounded.
- Runtime validation remains authoritative and additionally caps generic JSON at 10,000 nodes and
  Commands at 512 KiB.
- Read tools do not mutate editor state. Write tools use the shared `EditorStore.commitDurably()`
  path and semantic Command reducer.
- Every write result is `applied`, idempotent `duplicate`, `rejected`, or `ambiguous`. Ambiguous
  durability never instructs the caller to invent a new command ID.
- Invalid and unexpected errors return bounded public messages. Browser/storage exception details
  are not exposed to the model.
- Truncated previews and selections state whether continuation is available. The current API
  reports continuation as unavailable rather than pretending a partial preview is complete.
- One abort-controlled registration lifetime releases every tool when the active editor store is
  replaced or the page is unloaded.

The unit contract traverses every emitted schema and fails for unconstrained strings, numbers,
arrays, maps, unresolved local references, or permissive object tails. It also covers all four
write outcomes, bounded error redaction, truncation metadata, fresh store reads, and registration
cleanup.

Specification checked: [WebMCP Draft Community Group Report, 2 September
2026](https://webmachinelearning.github.io/webmcp/).
