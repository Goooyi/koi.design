# Stage 1 license review

Koi's Stage 1 monorepo is licensed under `AGPL-3.0-or-later`. This directory records the automated
dependency and asset review used for that release decision; it is an engineering provenance check,
not legal advice.

## Result

- The browser and MCP View runtime dependencies reviewed for Stage 1 use permissive MIT, ISC, or
  transition-compatible MCP license terms. Required acknowledgements are preserved in the root
  `NOTICE` and the deployed `NOTICE.txt`.
- AstryX Core `0.5.0` and StyleX `0.19.0` declare MIT in their published manifests. Because those
  tarballs omit `LICENSE`, `package-overrides.json` pins their official release commits and upstream
  license evidence.
- Lucide React `1.34.0` ships a combined ISC license and the MIT notice for Feather-derived icons;
  both acknowledgements are retained.
- Lightning CSS, axe-core, and the Playwright axe adapter (`MPL-2.0`) plus caniuse-lite
  (`CC-BY-4.0`) are build/test-time inputs and are not shipped in the static browser artifact.
- Two Yuku platform-binding packages omit both a license field and license file. Their npm
  provenance resolves to the MIT-licensed Yuku `v0.5.48` source repository, but the exact native
  binaries remain `NOASSERTION`. They are build-only and are not redistributed in the browser
  artifact. Re-audit before distributing `node_modules`, a Koi CLI, or an OCI image.
- The Stage 1 source tree bundles no raster images, audio, video, or webfonts. The Koi inline SVG
  favicon is project-authored; the AstryX icon registry uses Lucide/Feather.

## Reproduce the inventory

From a frozen install made with the repository-pinned package manager:

```sh
pnpm install --frozen-lockfile
pnpm licenses:generate
```

The command writes `docs/evidence/third-party-licenses.json` and `docs/evidence/assets.json`, fails
when an installed package has neither a declared license nor reviewed exact-version evidence, and
verifies that the deployed notice is byte-for-byte identical to the root notice. The report keeps
packages whose manifest declares a license but whose tarball omits the text in a separate review
list instead of hiding that condition.

Re-run the inventory after dependency or asset changes and on every platform whose native packages
will be distributed. Obtain legal review before company launch.
