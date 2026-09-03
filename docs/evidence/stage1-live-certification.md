# Stage 1 live certification

Certification window: `2026-09-03` (UTC and Asia/Singapore)

## Release identity

| Field                                 | Certified value                                             |
| ------------------------------------- | ----------------------------------------------------------- |
| Public application                    | `https://koi-design-webmcp-challenge.pages.dev/`            |
| Health endpoint                       | `https://koi-design-webmcp-challenge.pages.dev/health.json` |
| Application commit                    | `c31366f3ae3a7a58af56b9e7f7933bda4491b694`                  |
| Cloudflare Pages deployment           | `78efad47-5d7f-4b20-9b15-a9048dfdb2cb`                      |
| Immutable deployment URL              | `https://78efad47.koi-design-webmcp-challenge.pages.dev/`   |
| Public repository                     | `https://github.com/Goooyi/koi.design`                      |
| Repository license detected by GitHub | `AGPL-3.0` (`AGPL-3.0-or-later` in repository metadata)     |
| Native browser                        | Google Chrome `151.0.7922.174`                              |

Cloudflare reports the deployment as the current Production deployment from branch `main`, source
`c31366f`. The stable application UI shows that short build identifier; the health endpoint reports
the full application commit above. The challenge deployment remains anonymous and browser-local;
it requires no credentials.

## Independent gates

### Anonymous public clone

An HTTPS clone ran with Git credential helpers disabled in a newly created temporary directory.
`pnpm install --frozen-lockfile`, `pnpm run doctor`, `pnpm challenge:verify`, and `pnpm ready` all
passed at the application commit. The run used Node.js `v26.8.1`, pnpm `11.21.0`, no more than two
workspace tasks, and one Playwright worker. It passed 175 unit/protocol/integration tests, 3 doctor
contract tests, and 12 Chromium journeys. See [`public-clean-clone.md`](public-clean-clone.md) and
[`challenge-ready.json`](challenge-ready.json).

A second anonymous clone used an empty pnpm store and disabled Vite+ task caching. It downloaded
all 340 locked packages, reported zero cache hits across build, check, and test tasks, and passed
the same 175 + 3 + 12 checks. This closes the distinction between a clean checkout and a
cache-independent reproduction.

### Deployed HTTPS browser audit

The stable-Chrome audit ran directly against the public HTTPS URL. All 36 declared budgets passed.
It reported no console or page errors, failed requests, HTTP errors, or host-configuration
failures. It also verified the release health body, immutable hashed assets, SPA fallback, security
headers, bounded Frame virtualization, interaction timing, and post-GC retention. The automated
axe pass found no WCAG A/AA violations; color contrast remained an automated incomplete requiring
manual review. See [`browser-audit.json`](browser-audit.json).

### Native WebMCP contract

The release registers exactly these eight top-level tools through `document.modelContext`:

1. `get_canvas_context`
2. `list_components`
3. `inspect_elements`
4. `create_elements`
5. `update_elements`
6. `delete_elements`
7. `arrange_elements`
8. `export_document`

The deterministic local production-CSP Playwright journey executes every tool, checks structured
mutation receipts and versions, confirms export bounds, preserves camera and selection, verifies
deletion across reload, and observes no console, page, or CSP errors. The deployed build's
live-registration schemas are preserved in [`webmcp-tools.json`](webmcp-tools.json).

The production release capture exercises the challenge's agent/human-input-path/agent story from
an isolated stable-Chrome profile against the public deployment. A deterministic release harness—not model
deliberation or ChatGPT's Site Tools chrome—made 15 real native calls; all succeeded. Direct pointer
and keyboard events exercised the human interaction path and were observed by a fresh inspection;
persistence survived an uncut reload, camera and selection were preserved, and every diagnostic
error array was empty. See
[`native-webmcp-live.md`](native-webmcp-live.md), which records hashes for both the raw capture and
its machine-readable receipt.

The narrated delivery is 2:48.000 and passes the expected H.264/`yuv420p`/AAC media profile,
loudness scan, complete 5,040-frame decode, and representative encoded-frame review. See
[`demo-media.md`](demo-media.md). Public YouTube publication remains an account-bound step.

### ChatGPT in-app browser

The owner separately verified the native Site Tools surface in ChatGPT's in-app browser. The full
human-agent-human loop succeeded on deployed ancestor `d28cb01`: context and component reads,
creation of a card and button, reload persistence, a direct human drag, re-inspection of the newer
version, and version-checked refinement. The only later application change was the modifier-wheel
containment fix in `3447265`; the owner verified that fix on final deployment `c31366f`.

This distinction is deliberate: it records what was actually exercised in each environment and
does not present the earlier ChatGPT tool run as a second execution on the final SHA.

## Public-source and exposure checks

- Anonymous GitHub metadata reports `private: false`, `visibility: public`, default branch `main`,
  and detectable `AGPL-3.0` licensing.
- The repository description, live homepage, and `webmcp`, `mcp`, `local-first`, `design-tools`,
  and `react` discovery topics are public.
- A bounded history scan checked all 35 revisions reachable from deployed application commit
  `c31366f` for common private-key and service-token signatures and found no matching tracked path.
  This is a focused release check, not a guarantee against every possible secret format.
- The browser audit found no secret or private endpoint in the health payload or loaded public
  application surface.

## Certification boundary

This certifies the Stage 1 application deployment and its corresponding public source and
reproducible test evidence. Certification-document commits made after the deployed application SHA
are evidence-only changes; they do not alter the application artifact identified by the health
endpoint and Cloudflare deployment ID.

It does not claim Stage 2 accounts, multiplayer, managed hosting, comments, complete HTML export,
or programmable WebGPU rendering. Public YouTube publication and confirmed Devpost submission are
separate account-bound release steps and must be added to the final submission evidence.
