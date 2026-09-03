# Public clean-clone certification

- Recorded: `2026-09-03T12:41:28Z`
- Repository: `https://github.com/Goooyi/koi.design.git`
- Certified commit: `c31366f3ae3a7a58af56b9e7f7933bda4491b694`
- Clone authentication: none; HTTPS clone ran with the Git credential helper disabled
- Runtime: Node.js `v26.8.1`, pnpm `11.21.0`
- Install: frozen lockfile accepted; 340 packages reused from the content-addressable store and
  zero packages downloaded
- Resource bounds: at most two workspace tasks and one Playwright worker
- Source status after verification: clean

The following commands completed successfully from a newly created temporary directory outside
every existing Koi worktree:

```sh
git -c credential.helper= clone https://github.com/Goooyi/koi.design.git koi.design
cd koi.design
pnpm install --frozen-lockfile
pnpm run doctor
pnpm challenge:verify
pnpm ready
```

Results:

- 175 unit, protocol, and integration tests passed.
- 3 doctor contract tests passed.
- 12 Chromium journeys passed, including native WebMCP under strict CSP and modifier-wheel
  containment.
- The environment doctor reported `challengeAppReleasePrerequisitesPass: true`, including stable
  Chrome `151.0.7922.174`, Wrangler `4.128.0`, and a clean worktree.
- The challenge build verifier confirmed build identity, hashed assets, Content Security Policy,
  SPA fallback behavior, and a clean source tree.
- Formatting, lint, type checking, and every production build passed.

This proves the public repository can be cloned without owner credentials and does not depend on
the owner's untracked planning bundle, local worktrees, or a prebuilt package directory.

## Empty-store and task-cache-disabled follow-up

At `2026-09-03T13:39Z`, a second anonymous clone of the same commit installed with a newly created,
empty pnpm content-addressable store. The frozen install downloaded and added all 340 packages;
none were reused. The release gate was then repeated as its equivalent component commands with
Vite+ `--no-cache` on every workspace task. The path below is an illustrative shell variable, not
the ephemeral literal directory used by the run:

```sh
pnpm install --frozen-lockfile --store-dir "$EMPTY_PNPM_STORE"
vp run -r --concurrency-limit 2 --no-cache build
vp run -r --concurrency-limit 2 --no-cache check
node --test scripts/lib/doctor-contract.test.mjs
vp run -r --concurrency-limit 2 --no-cache test
vp exec playwright test --workers=1
```

The build reported 0/8 cache hits, checks reported 0/16, and tests reported 0/17. All formatting,
lint, type, and build checks passed; 175 workspace tests, 3 doctor contract tests, and 12 Chromium
journeys passed. The server tests require local loopback sockets, so the sandbox-only attempt
failed five `listen EPERM` cases and the same no-cache command passed outside that network sandbox.
This follow-up establishes that neither the dependency store nor Vite+ task results are required
to reproduce the successful release gates. Unlike the primary `pnpm ready` certification, this
supplementary no-cache run has a summarized result rather than a checked-in raw transcript.
