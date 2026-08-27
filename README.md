# Koi Design

Koi is a portable, local-first spatial design workspace where humans and agents edit the same structured document. It combines a Paper-style HTML/CSS design canvas with Miro-style exploration, without making one AI host or one hosted product the source of truth.

The project is currently in system-design and challenge-prototype stage.

## Product thesis

- One Page is an infinite spatial surface containing many Frames, so alternatives, flows, components, notes, and visual assets can be explored together.
- Frames render real HTML/CSS and trusted Astryx components. The canvas is not a screenshot-only or GPU-only scene.
- Humans and agents use the same semantic command model. An agent learns that a human moved a component from Koi's event stream, not by guessing from pixels or DOM mutations.
- WebMCP, MCP Apps over local stdio, and hosted HTTP MCP are first-class product surfaces over one application core.
- Documents remain portable through a versioned Koi format, native web export, and explicit design-system profiles.

## Working documents

- [Domain language](CONTEXT.md)
- [System design](docs/system-design.md)
- [Repository and toolchain](docs/project-structure.md)
- [Testing strategy](docs/testing.md)
- [WebMCP Challenge plan](docs/challenge-2026.md)
- [Open decision queue](docs/open-questions.md)
- [Architecture decisions](docs/adr)

## Current delivery recommendation

The WebMCP Challenge deadline makes the standalone web canvas plus native WebMCP journey the first vertical slice. The stdio MCP App then reuses the same core; hosted collaboration follows. This ordering remains the first open owner decision in [docs/open-questions.md](docs/open-questions.md).

## Agent browser tooling

The repository includes a project-scoped Chrome DevTools MCP configuration in [`.codex/config.toml`](.codex/config.toml). It launches an isolated headless Chrome with coordinate vision, memory diagnostics, and experimental native WebMCP tools enabled. A new Codex task or app restart may be required before the server appears.
