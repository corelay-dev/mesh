# Contributing to Corelay Mesh

We welcome issues and pull requests. Thank you for considering contributing.

## Getting started

```bash
git clone https://github.com/corelay-dev/mesh.git
cd mesh
npm install
npm run build
npm test
```

Requirements: Node 20+, Docker (for `@corelay/mesh-postgres` integration tests via testcontainers).

## Guidelines

- **One concern per commit.** We prefer five small commits to one large one.
- **Tests required** for non-trivial changes. `npm test` must pass before pushing.
- **TypeScript strict mode**, `noUncheckedIndexedAccess`. No `any`.
- **Conventional Commits** format: `feat:`, `fix:`, `chore:`, `docs:`, `test:`.
- **No CLA.** Contributions are MIT-licensed, same as the repo.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your changes with tests.
3. Run `npm run build && npm test` locally.
4. Open a PR with a clear description of what changed and why.

For larger changes, please open an issue first to discuss the shape. We'd rather align early than review a large PR that doesn't fit.

## Issues

- **Bug reports:** include steps to reproduce, expected vs actual behaviour, and your Node/OS version.
- **Feature requests:** describe the use case, not just the solution. We may already have it planned or have a reason it's shaped differently.
- **Questions:** GitHub Discussions (when enabled) or open an issue tagged `question`.

## Code of conduct

Be respectful. We don't have a formal CoC document yet, but the standard applies: no harassment, no discrimination, no personal attacks. We're building tools for mission-led domains; the community should reflect that.

## Security

Found a vulnerability? See [SECURITY.md](./SECURITY.md). Do not open a public issue.
