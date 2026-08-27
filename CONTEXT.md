# Koi domain language

This file defines the words used in product discussion, code, tests, and agent tools. When a familiar design-tool term conflicts with this glossary, this glossary wins.

## Ownership and space

**Workspace** — A collaboration and ownership boundary containing Documents and members.

**Document** — A portable design artifact containing one or more Pages, assets, design settings, and history identity.

**Page** — One persistent infinite spatial surface within a Document.

**Canvas** — The interactive editor viewport through which a person or agent observes and manipulates the active Page. Canvas is a UI term, not a stored container.

**Camera** — The transient pan and zoom through which the Canvas projects a Page.

## Scene

**Element** — A durable object placed on a Page. Every Element has a stable identity and semantic type.

**Frame** — A bounded container Element placed on a Page. A Frame commonly represents one screen, component study, visual asset, or design alternative and may contain nested Elements.

**Component instance** — An Element whose kind and editable properties are defined by a trusted component registry entry.

**Shape** — A geometric Element such as a rectangle, ellipse, arrow, or line.

**Connector** — An Element that expresses a semantic relationship between Elements and follows their anchors.

**Ink stroke** — A freehand path authored with a pen or pointer.

**Text element** — Editable text that belongs to the design artifact.

**Annotation** — Collaborative content, such as a comment or review note, that refers to design content but is not part of exported product UI.

**Asset** — Portable media referenced by Elements, such as an image, font, or video.

**Shader element** — A visual Element produced from a named procedural shader and serializable parameters.

## Change and collaboration

**Interaction** — Transient pointer, keyboard, camera, selection, or editing activity. An Interaction may produce no durable change.

**Command** — A human or agent's request to perform one durable intent against a Document.

**Operation** — A bounded semantic change carried by a Command, such as moving an Element or setting a property.

**Revision** — A monotonic version used to state which content a reader observed and to detect conflicting edits.

**Projection** — The current document state produced by applying accepted changes.

**Outbox** — Durable local work that has committed to the Projection but has not yet been acknowledged by another persistence surface.

**Undo group** — One reversible unit of human or agent intent. Undo adds a compensating change; it does not move history backwards.

**Presence** — Ephemeral awareness such as a collaborator's cursor, selection, or active tool. Presence is not document history.

**Human edit** — A Command attributed to a person.

**Agent edit** — A Command attributed to an agent surface. Agent edits remain visible, attributable, and reversible.

## Portability and components

**Koi document** — The versioned, renderer-independent representation of a Document.

**DESIGN.md source** — Portable design intent imported from or exported to the evolving DESIGN.md convention.

**Koi Astryx profile** — A versioned, namespaced mapping between portable design intent and one supported Astryx release.

**Trusted component registry** — The catalog of component kinds Koi is willing to instantiate, including their validated properties, slots, defaults, inspector information, and trusted renderer identity.

**Native web export** — HTML, CSS, assets, and supported component code derived from a Koi document for use outside Koi.

## Product surfaces

**Standalone web app** — Koi running as a top-level website, with human UI and WebMCP in the same page.

**Self-hosted server** — The current single-owner Node service that persists Workspaces and
Documents to bounded files, serves the web app, accepts authenticated REST commands, publishes
SSE revision wake-ups, and exposes per-Document Streamable HTTP MCP. It is not a multiplayer
service.

**WebMCP** — The browser-facing agent tool surface registered by the top-level Koi website.

**MCP server** — A local or hosted process that exposes Koi tools and UI resources through MCP.

**MCP host** — The client application that connects to an MCP server and may embed an MCP View, such as ChatGPT, Claude Desktop, VS Code, or another compatible client. The host is not the MCP server.

**MCP View** — A complete web document rendered by an MCP host inside a sandboxed iframe and connected to the host through the MCP Apps bridge.

## Terms to keep distinct

- The Paper reference image shows one Page containing six Frames, not six Pages on one Canvas.
- Canvas means the editor viewport; Page means the persistent spatial surface.
- A Component instance is not arbitrary third-party JavaScript. Its renderer must be present in the trusted registry.
- The self-hosted service and stdio MCP server are different entry surfaces. Hosted MCP is the
  dedicated `/api/v1/documents/:documentId/mcp` route, not the ordinary REST command API.
- tldraw, Onlook, GrapesJS, Mitosis, Panda, and pxpipe are reference material unless a later decision explicitly adopts them. They are not current Koi dependencies.

## Example dialogue

> A human opens a Document, pans the Canvas to Frame 3 on the active Page, moves a Button component instance, and commits one Human edit. A WebMCP agent then inspects the new Revision and creates an alternative Frame without changing the human's Camera or Selection.
