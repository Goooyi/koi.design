# Koi open decision queue

The MVP architecture and build order are settled. These decisions remain deliberately open; none
should block local development of the implemented product.

## 1. License and contributor rights

Status: owner decision deferred.

Koi currently has no `LICENSE`, so it must not yet be described as open source and outside
contributions should not be accepted. Before making the repository public, choose the product
license, document third-party notices, and decide whether contributions require a DCO, CLA, or
neither.

The decision must preserve the agreed product boundary: the complete self-hostable product can be
public, while a future managed-service control plane may remain private. A private service must
consume public Koi artifacts rather than become a hidden dependency of the self-hostable editor or
challenge workflow.

## 2. Authentication and managed hosting

Status: required before multi-user or public-internet deployment.

The self-host server has one deployment-owner Bearer token. Accounts, sessions, organizations,
membership, document authorization, invitations, billing, quotas, backups, tenant provisioning,
abuse controls, and compliance belong to a later identity/control-plane design. Do not extend the
single-owner token into an accidental multi-tenant model.

## 3. Collaboration protocol

Status: measure after durable multi-client testing.

The server orders semantic commands and publishes SSE revision wake-ups. One browser can reconnect
to the same persisted hosted authority, replay its IndexedDB outbox in history order, checkpoint
each acknowledgement, and stop with later Commands preserved when a conflict occurs. It still has
no Presence and is not a CRDT. Cross-client actor identity, catch-up, conflict resolution UX,
retention, and ordering remain open before Koi can claim real-time collaboration. A Projection
currently rejects its 50,001st retained Command. Standalone local export then import starts a fresh
Projection, while hosted and stdio recovery requires a new Document or data file because neither
repository compacts history in place. Reserve Yjs for genuinely contentious rich text unless
product evidence supports a wider role.

## 4. Native export and design profiles

Status: next portability slice.

The product exports validated `.koi.json`; the Astryx registry has component-level HTML helpers.
A complete Page-to-HTML/CSS/assets workflow and DESIGN.md import/export still need an observable
contract, asset policy, and round-trip tests.

## 5. Canvas performance budgets

Status: benchmark fixtures needed.

The MVP has a coalesced camera transform, per-Element store subscriptions, layout/style
containment, a uniform-grid visibility query, and whole-root virtualization. The Canvas shell still
subscribes to each committed Projection, so record subscriptions are not yet complete render
isolation. Set live-Frame, DOM, SVG ink, server, and memory budgets from real fixture curves. Add
distant previews, retained geometry, or stronger selector/memoization boundaries only when a
measured bottleneck justifies them. Rotation remains fixed to `0` until every renderer and
interaction shares one affine-transform contract.

## 6. WebGPU Shader elements

Status: deferred product capability.

Koi records Shader elements and displays a non-GPU fallback. The first programmable effect must
define trusted WGSL provenance, capability detection, device-loss behavior, pixel/animation
budgets, offscreen suspension, and accessibility. Koi ships no WebGL2/GLSL fallback.

## 7. Advisory AI testing and showcase

Status: after native deterministic journeys pass.

Choose a Midscene provider and privacy boundary only for synthetic workspaces. Hyperframes or a
future Remotion app can produce the showcase video; neither belongs in the product runtime.

## 8. Durable hosted publish intent

Status: P2 crash-recovery follow-up.

The browser retains an unresolved hosted Publish request in memory so retries within the running
page reuse the exact command ID, expected Revision, and payload. Reloading or closing the page loses
that identity. Persist the bounded intent in IndexedDB, define its startup reconciliation UX, and
prove cleanup after authoritative Open before claiming publish recovery across browser restarts.
