# Versioning

Corelay Mesh follows [Semantic Versioning](https://semver.org/).

## Current status: `0.x` (pre-1.0)

All packages are on `0.1.0`. The API is stabilising but not locked. Between minor versions (`0.1.0` → `0.2.0`), breaking changes may occur. We document them in [CHANGELOG.md](./CHANGELOG.md).

## Path to 1.0.0

Target: **Q3 2026**.

Before we cut `1.0.0`, we need:

1. **At least one external adopter** validating the API surface in a real project.
2. **Stable type signatures** — no breaking changes to `AgentConfig`, `Peer`, `Inbox`, `Capability`, `Workflow`, `Message`, `LLMClient`, `Tracer` for at least 4 weeks.
3. **Compose and Eval APIs stable** — `compose()`, `approve()`, `runEval()`, `compareReports()` unchanged for at least 4 weeks.
4. **Migration guide** from `0.x` to `1.0.0` written and tested.

## After 1.0.0

- **Patch** (`1.0.x`): bug fixes, no API changes.
- **Minor** (`1.x.0`): new features, backward-compatible. New exports, new optional fields, new packages.
- **Major** (`x.0.0`): breaking changes. Migration guide required. We aim for no more than one major per year.

## Cross-package versioning

All `@corelay/mesh-*` packages share the same version number. When one package bumps, they all bump. This keeps the dependency graph simple — you never have `mesh-core@1.2.0` depending on `mesh-observe@1.1.0`.

## Deprecation policy

Deprecated APIs are marked with `@deprecated` JSDoc tags and logged with `console.warn` on first use. They are removed in the next major version, not before.
