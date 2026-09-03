#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const virtualStore = path.join(repositoryRoot, "node_modules", ".pnpm");
const evidenceDirectory = path.join(repositoryRoot, "docs", "evidence");
const overridesPath = path.join(repositoryRoot, "docs", "licenses", "package-overrides.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function listWorkspaceManifests() {
  const manifests = ["package.json"];

  for (const parent of ["apps", "packages"]) {
    const entries = await fs.readdir(path.join(repositoryRoot, parent), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) manifests.push(path.join(parent, entry.name, "package.json"));
    }
  }

  return manifests.sort();
}

async function collectDirectUses(manifestPaths) {
  const uses = new Map();
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

  for (const manifestPath of manifestPaths) {
    const manifest = await readJson(path.join(repositoryRoot, manifestPath));
    for (const section of sections) {
      for (const dependencyName of Object.keys(manifest[section] ?? {})) {
        if (dependencyName.startsWith("@koi/")) continue;
        const current = uses.get(dependencyName) ?? [];
        current.push({ section, workspace: manifest.name });
        uses.set(dependencyName, current);
      }
    }
  }

  for (const value of uses.values()) {
    value.sort((left, right) =>
      `${left.workspace}:${left.section}`.localeCompare(`${right.workspace}:${right.section}`),
    );
  }
  return uses;
}

async function packageRootsWithin(nodeModulesPath) {
  const roots = [];
  const entries = await fs.readdir(nodeModulesPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(nodeModulesPath, entry.name);
    if (entry.isSymbolicLink()) continue;

    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scopedEntries = await fs.readdir(entryPath, { withFileTypes: true });
      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) {
          roots.push(path.join(entryPath, scopedEntry.name));
        }
      }
      continue;
    }

    if (entry.isDirectory()) roots.push(entryPath);
  }

  return roots;
}

async function collectInstalledPackageRoots() {
  const roots = [];
  const storeEntries = await fs.readdir(virtualStore, { withFileTypes: true });

  for (const storeEntry of storeEntries) {
    if (!storeEntry.isDirectory()) continue;
    const nodeModulesPath = path.join(virtualStore, storeEntry.name, "node_modules");
    try {
      roots.push(...(await packageRootsWithin(nodeModulesPath)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return roots;
}

function declaredLicense(manifest) {
  if (typeof manifest.license === "string" && manifest.license.trim())
    return manifest.license.trim();
  if (Array.isArray(manifest.licenses)) {
    const licenses = manifest.licenses
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter((entry) => typeof entry === "string" && entry.trim())
      .map((entry) => entry.trim());
    if (licenses.length > 0) return licenses.join(" OR ");
  }
  return null;
}

function repositoryUrl(repository) {
  if (typeof repository === "string") return repository;
  if (repository && typeof repository.url === "string") return repository.url;
  return null;
}

async function localLicenseFiles(packageRoot) {
  const entries = await fs.readdir(packageRoot, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/^(licen[cs]e|copying|notice)(\.|$)/i.test(entry.name)) continue;
    const content = await fs.readFile(path.join(packageRoot, entry.name));
    files.push({ file: entry.name, sha256: sha256(content) });
  }

  return files.sort((left, right) => left.file.localeCompare(right.file));
}

async function collectPackages(directUses, overrides) {
  const packages = new Map();

  for (const packageRoot of await collectInstalledPackageRoots()) {
    let manifest;
    try {
      manifest = await readJson(path.join(packageRoot, "package.json"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") continue;

    const key = `${manifest.name}@${manifest.version}`;
    if (packages.has(key)) continue;
    const override = overrides[key] ?? null;
    const declared = declaredLicense(manifest);
    const licenseFiles = await localLicenseFiles(packageRoot);

    packages.set(key, {
      name: manifest.name,
      version: manifest.version,
      declaredLicense: declared,
      verifiedLicense: override?.license ?? declared,
      directUses: directUses.get(manifest.name) ?? [],
      homepage: typeof manifest.homepage === "string" ? manifest.homepage : null,
      repository: repositoryUrl(manifest.repository),
      localLicenseFiles: licenseFiles,
      upstreamEvidence: override
        ? {
            url: override.evidenceUrl,
            note: override.note,
          }
        : null,
      reviewStatus: override?.license
        ? "reviewed-from-upstream-evidence"
        : declared && licenseFiles.length > 0
          ? "reviewed-from-installed-package"
          : declared
            ? "declared-license-without-local-license-file"
            : "unresolved",
    });
  }

  for (const key of Object.keys(overrides)) {
    if (!packages.has(key))
      throw new Error(`License override does not match an installed package: ${key}`);
  }

  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}

async function sourceHash(manifestPaths) {
  const inputPaths = [
    "NOTICE",
    "apps/web/index.html",
    "apps/web/public/NOTICE.txt",
    "docs/licenses/package-overrides.json",
    "pnpm-lock.yaml",
    "scripts/generate-license-evidence.mjs",
    ...manifestPaths,
  ];
  const hash = createHash("sha256");
  for (const inputPath of inputPaths.sort((left, right) => left.localeCompare(right))) {
    hash.update(inputPath);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(repositoryRoot, inputPath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function trackedAssetEvidence() {
  const indexPath = path.join(repositoryRoot, "apps", "web", "index.html");
  const indexSource = await fs.readFile(indexPath, "utf8");
  if (!indexSource.includes("data:image/svg+xml") || !indexSource.includes("%3Csvg")) {
    throw new Error("Expected the Koi-authored inline SVG favicon in apps/web/index.html");
  }

  return {
    schemaVersion: 1,
    assets: [
      {
        id: "koi-inline-svg-favicon",
        sourcePath: "apps/web/index.html",
        sourceSha256: sha256(indexSource),
        kind: "inline-svg-favicon",
        provenance: "Koi-authored project artwork",
        license: "AGPL-3.0-or-later",
      },
      {
        id: "astryx-lucide-icon-set",
        sourcePath: "@astryxdesign/theme-neutral@0.5.0",
        kind: "runtime-icon-component-set",
        provenance: "AstryX neutral theme using Lucide and Feather-derived icons",
        license: "ISC AND MIT",
        notice: "See NOTICE and the dependency inventory for package-level evidence.",
      },
    ],
    absentByInspection: [
      "bundled raster images",
      "bundled audio",
      "bundled video",
      "bundled webfonts",
    ],
  };
}

async function writeJson(relativePath, value) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(path.join(repositoryRoot, relativePath), output, "utf8");
}

const manifestPaths = await listWorkspaceManifests();
const overrides = await readJson(overridesPath);
const directUses = await collectDirectUses(manifestPaths);
const packages = await collectPackages(directUses, overrides);
const licenseCounts = Object.fromEntries(
  [
    ...packages.reduce((counts, entry) => {
      const license = entry.verifiedLicense ?? "UNRESOLVED";
      counts.set(license, (counts.get(license) ?? 0) + 1);
      return counts;
    }, new Map()),
  ].sort(([left], [right]) => left.localeCompare(right)),
);
const unresolved = packages
  .filter((entry) => entry.reviewStatus === "unresolved")
  .map((entry) => `${entry.name}@${entry.version}`);
const declaredWithoutLocalLicenseFile = packages
  .filter((entry) => entry.reviewStatus === "declared-license-without-local-license-file")
  .map((entry) => `${entry.name}@${entry.version}`);

const evidence = {
  schemaVersion: 1,
  sourceInputsSha256: await sourceHash(manifestPaths),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    packageManager: "pnpm@11.21.0",
  },
  summary: {
    packageVersions: packages.length,
    directPackageNames: directUses.size,
    licenseCounts,
    unresolved,
    declaredWithoutLocalLicenseFile,
  },
  packages,
};

await fs.mkdir(evidenceDirectory, { recursive: true });
await writeJson("docs/evidence/third-party-licenses.json", evidence);
await writeJson("docs/evidence/assets.json", await trackedAssetEvidence());

const rootNotice = await fs.readFile(path.join(repositoryRoot, "NOTICE"));
const deployedNotice = await fs.readFile(
  path.join(repositoryRoot, "apps", "web", "public", "NOTICE.txt"),
);
if (!rootNotice.equals(deployedNotice)) {
  throw new Error("NOTICE and apps/web/public/NOTICE.txt must remain byte-for-byte identical");
}

if (unresolved.length > 0) {
  console.error(`Unresolved package licenses: ${unresolved.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Recorded ${packages.length} package versions and 2 bundled asset declarations.`);
}
