# Security policy

Koi's current self-hosted release is a bounded single-owner service intended to run on a trusted
machine or behind an HTTPS reverse proxy. It is not designed for untrusted multi-tenant use.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private security advisory
workflow for this repository. Include the affected commit, reproduction, impact, and any known
mitigation. Do not include real deployment tokens or customer Documents.

No formal response-time SLA exists yet.

## Deployment requirements

- Generate a unique `KOI_AUTH_TOKEN` with at least 32 random bytes and store it outside version
  control. Treat it as administrator access. The web app holds the entered token only in page
  memory. IndexedDB persists only non-secret per-Document authority metadata, including a hosted
  base URL; tab-scoped `sessionStorage` may also retain that URL as a connection-form prefill.
- Keep the default loopback bind or place Koi behind an HTTPS reverse proxy. Set
  `KOI_PUBLIC_ORIGIN` to the exact external origin.
- Run one service process per data directory. Shared storage and multiple writers are unsupported.
- Run one local stdio MCP process per `KOI_MCP_DATA_FILE`. Its Projection file contains design
  content and should use a private directory owned by that process user. Keep the 4 MiB inbound
  message cap and bounded mutation admission enabled when embedding the server.
- Back up the persistent data volume and test restore procedures before upgrades.
- Keep browser automation on isolated profiles and synthetic Documents; traces and screenshots may
  contain sensitive design content.
- Review dependency and container updates before deployment and rerun all repository gates.

The built-in token is not an account or authorization system. Do not use this release to isolate
mutually untrusted users or organizations.
