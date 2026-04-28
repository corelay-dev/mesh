# Contributing to @corelay/agent

Thank you for considering a contribution. This SDK is used in production across
multiple AI services, so the bar for changes is "it must not make things worse
in the 99th percentile."

## Principles

- **Zero runtime dependencies.** Pull requests that add runtime `dependencies`
  will be declined unless there is no reasonable alternative.
- **Non-blocking.** Nothing the agent does should be able to block the host
  service's main thread or event loop beyond microsecond scales.
- **Cap-and-drop over queue-forever.** Local buffers must have hard caps. When
  the transport fails, drop old data rather than grow unboundedly.
- **Type-preserving wrappers.** `wrapBedrock` / `wrapOpenAI` must not alter the
  public type signature of the wrapped client.

## Development

```bash
git clone https://github.com/corelay/agent.git
cd agent
npm install
npm run build
```

## Pull request checklist

- [ ] Unit tests for new behaviour (when tests are added to this repo)
- [ ] `npm run build` passes
- [ ] No new runtime dependencies (or a clear justification in the PR description)
- [ ] Public types in `src/types.ts` are updated if the API surface changed
- [ ] README updated if the public API changed

## Reporting issues

- Use GitHub Issues for bugs, performance regressions, or feature requests
- Include Node version, SDK version, and a minimal reproduction
- For security issues, email security@corelay.dev instead of filing a public
  issue

## Commit style

Conventional commits preferred:
- `feat: add X`
- `fix: correct Y`
- `chore: bump deps`
- `docs: improve Z`

## License

By contributing, you agree that your contributions will be licensed under the
MIT License (see `LICENSE`).
