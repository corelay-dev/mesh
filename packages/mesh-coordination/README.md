# @corelay/mesh-coordination

Named coordination primitives for Corelay Mesh.

Week 2 ships `Critic`; `Hierarchy`, `Pipeline`, and `Human-in-the-loop` follow.

**Status: Week 2 — in development.**

## Why a separate package

The primitives build on `@corelay/mesh-core` but are independent of any LLM or storage provider. Keeping them in their own package means a project that wants only `Critic` doesn't pull in the coordination code for `Debate` or `Hierarchy`.
