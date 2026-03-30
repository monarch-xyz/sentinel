# Sentinel Source Refactor Plan

This document is the shared working plan for refactoring Sentinel toward a simpler core model:

- Basic primitive 1: RPC state reads
- Basic primitive 2: raw event reads
- Advanced primitive: indexed semantic views (Envio / ENDO / other protocol-specific integrations)

This file doubles as the live TODO list so collaborators can see current progress and help in parallel.

## Goals

1. Make basic data access primitive-first, not metric-first.
2. Keep the product surface focused on:
   - raw RPC state
   - raw events
3. Keep indexed semantic datasets as an advanced integration layer.
4. Keep docs, validation, and tests updated at every step.
5. Treat existing persisted signals as non-blocking for this refactor unless we explicitly decide otherwise.

## Constraints

- Prefer no DB schema migration unless it becomes clearly necessary.
- Every phase must include:
  - implementation
  - tests
  - validation updates
  - documentation updates
- Use Codex for all coding tasks.

## Current architecture observations

- Current engine docs are family-first, but implementation is still largely Morpho-first.
- `metrics.ts` remains the main authoring abstraction for many cases.
- `EventRef` currently means indexed semantic events, while `RawEventRef` is the true raw log primitive.
- Historical block resolution still lives under `envio/`, even though it is generic infrastructure.
- Generic RPC state access is not yet modeled as a first-class primitive.

## Phase plan

### Phase 1 — Introduce a generic RPC state primitive

Objective:
- Add a truly generic internal representation for RPC state reads so “well-known state” becomes syntax sugar on top of a generic contract-read model.

Scope:
- Add generic RPC state read types and planner/fetcher path.
- Keep existing Morpho state support working by compiling Morpho sugar into the new primitive where practical.
- Move naming and docs toward primitive-first language.

Expected outputs:
- New generic state AST/internal type(s)
- Planner updates for generic RPC state reads
- Fetcher support for generic contract reads
- Tests for compile/evaluate/fetch planning behavior
- Docs updated to explain primitive-first state reads

Status checklist:
- [x] Write/update plan doc
- [x] Create implementation branch
- [x] Add generic RPC state read type(s)
- [x] Wire source planner to generic RPC state reads
- [x] Adapt fetcher/runtime path
- [x] Add/update unit tests
- [ ] Run validation (`pnpm test`, `pnpm typecheck`, `pnpm lint:check` if applicable)
- [x] Update architecture/docs
- [x] Open PR

### Phase 2 — Implement generic archive RPC execution

Objective:
- Add a true generic archive-RPC execution layer behind the new planning primitive so Sentinel can call arbitrary contracts, including unusual contracts with fixed bytes arguments.

Scope:
- Add a generic RPC call representation suitable for archive-node execution.
- Support ABI/signature-driven `eth_call` execution with typed arguments.
- Support historical block execution via timestamp-to-block resolution.
- Keep Morpho behavior working while proving the generic executor with at least one real path.

Expected outputs:
- Generic RPC call/internal execution type(s)
- Generic archive-node `eth_call` executor
- Argument encoding and output decoding path
- Historical block-aware execution path
- Tests for planning/execution/decoding behavior
- Docs updated to explain generic archive RPC execution and current limits

Status checklist:
- [x] Define generic RPC call shape
- [x] Implement archive-node `eth_call` executor
- [x] Support weird/fixed-bytes arguments in the execution path
- [x] Wire at least one real runtime path through the generic executor
- [x] Add/update unit tests
- [ ] Run validation
- [x] Update docs
- [x] Open PR

### Phase 3 — Expand raw event primitives and well-known event catalog

Objective:
- Make raw events the default event primitive and support a broader catalog of well-known events as syntax sugar.

Scope:
- Expand event catalog/registry approach for well-known raw events.
- Improve DSL/compiler shape for raw-event authoring.
- Keep indexed semantic event support as advanced-only.

Expected outputs:
- Well-known event catalog definitions
- Improved raw event compiler path
- Better filter/validation model for common event families
- Docs and frontend-facing guidance for event catalog usage

Status checklist:
- [ ] Define catalog structure for well-known raw events
- [ ] Add first batch of well-known events
- [ ] Improve compiler/validation path
- [ ] Add/update unit tests
- [ ] Run validation
- [ ] Update docs
- [ ] Open PR

### Phase 4 — Reframe indexed semantic data as advanced integration

Objective:
- Make indexed semantic reads clearly optional and advanced, both internally and in docs.

Scope:
- Rename or re-document indexed semantics to avoid them feeling like the default event model.
- Make capability boundaries clearer.
- Keep plugin/integration mindset explicit.

Expected outputs:
- Clear internal naming for indexed semantic reads
- Capability and readiness updates
- Docs reflecting advanced integration model
- Optional UI/API surface adjustments

Status checklist:
- [ ] Refine indexed semantic naming/boundaries
- [ ] Update capability reporting
- [ ] Add/update tests
- [ ] Run validation
- [ ] Update docs
- [ ] Open PR

### Phase 5 — Catalog-driven templates and UX cleanup

Objective:
- Drive builder/template surfaces from basic primitives and catalogs instead of narrow hardcoded flows.

Scope:
- Backend catalog endpoint(s) if needed
- Frontend builder/template updates
- Better separation between Basic and Advanced authoring

Status checklist:
- [ ] Define backend catalog contract
- [ ] Implement frontend consumption path
- [ ] Add/update tests
- [ ] Run validation
- [ ] Update docs
- [ ] Open PR

## Immediate next step

We are now moving to Phase 3:
- expand raw event primitives and introduce a broader well-known event catalog
- keep indexed semantic data as advanced-only
- continue updating docs/tests/validation as each step lands

## Working notes

### Decisions
- Existing stored signals are not the priority for this refactor.
- Avoid DB schema changes in the first pass unless they become unavoidable.
- Keep `planRpcStateRead` as a temporary compatibility wrapper while moving runtime internals to `planGenericRpcStateRead`.

### Open questions
- What is the cleanest generic state representation: function-signature based, ABI-fragment based, or contract-method catalog based?
- How much backward-compatibility sugar should remain in the compiler versus being deprecated immediately?
- Should block resolution infrastructure move in Phase 1 or a follow-up phase?

### Phase 2 implementation notes
- Generic call representation now uses `GenericRpcCall` + typed args (`RpcTypedArg`) and is produced for Morpho state reads via `bindMorphoArchiveRpcExecution`.
- Archive execution now runs through `executeArchiveRpcCall` in `src/rpc/client.ts`, using signature-driven encoding and output decoding.
- Morpho fetcher current/historical state reads now execute through the generic path; historical reads still resolve timestamps to blocks before execution.
- Legacy `readPosition*` and `readMarket*` helpers now delegate to the same generic executor to keep behavior aligned.

## Update protocol

Whenever work advances in this refactor:
1. Update the relevant phase checklist in this file.
2. Add or revise implementation notes here.
3. Keep architecture docs aligned before opening the PR.
