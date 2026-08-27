# ADR 0002: Give first-class product surfaces one shared core

- Status: Accepted
- Date: 2026-08-27

## Context

Koi must work as a standalone web app with WebMCP, a local/SSH stdio MCP App, and a hosted HTTP MCP App. Protocol maturity differs, but allowing each surface to mutate its own state would create inconsistent behavior and make human-agent collaboration unreliable.

## Decision

Human UI, top-level WebMCP, and MCP adapters call the same command/query service. Protocol-specific mapping stays at the edge. WebMCP is a first-class product surface with parity in semantic behavior, user feedback, documentation, tests, and release gates; its evolving browser API remains isolated behind an adapter.

WebMCP tools register centrally at the top-level page with a stable catalog. MCP Views communicate through the host bridge and call server tools; they never assume `localhost` identifies their MCP server.

## Consequences

- Human and agent edits share validation, conflict handling, attribution, history, undo, and export.
- Draft API changes remain localized without demoting WebMCP to an experiment.
- The stdio and hosted adapters can follow the challenge web slice without redesigning the product core.
- Adapter contract tests must prove equivalent observable results across surfaces.
- Features unique to a host are capability-negotiated rather than assumed.
