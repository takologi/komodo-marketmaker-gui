# Architectural Plan for the Komodo Market Maker GUI / KCB / KDF Stack

## 1. Purpose of this document

This document defines the **fixed architectural decisions**, the **end goal**, the **current implementation direction**, the **strict NO-GOs**, and the **open questions** for the application.

It is intended to be used by an AI coding assistant (GitHub Copilot / Claude Sonnet 4.6) to:

1. inspect the current codebase,
2. compare it against the agreed target architecture,
3. identify mismatches,
4. propose the next development steps,
5. avoid violating already fixed architectural boundaries.

This document should be treated as a **high-priority source of truth** for architecture-level decisions.

---

## 2. Product goal

### Immediate practical goal
The immediate goal is to build a **working first version** of an application that can:

- bootstrap and maintain market-making liquidity,
- monitor that liquidity online,
- allow safe operator control over parameters,
- validate the proposed architecture in real conditions,
- test already implemented KDF changes,
- do all of the above **without requiring deeper KDF modifications for now**.

The application rely upon the Komodo DeFi Framework (KDF) - its market making capabilities and DEX swapping functionality.

### Business goal
The first real-world goal is **not profit maximization**.

The main real-world goal is to:

- create an initial market for **Rincoin**,
- provide liquidity where little or no market currently exists,
- demonstrate that Rincoin can be bought with meaningful liquidity,
- increase visibility and credibility of Rincoin toward larger market participants,
- show practical liquidity to exchanges, aggregators, and ecosystem actors.

This means the first implementation priorities are:

- stability,
- safety,
- transparency,
- observability,
- operational control,
- deterministic behavior,

and **not** advanced alpha-seeking strategy logic.

---

## 3. End-state vision

In the long term, the system should become a robust operator stack for KDF-native market making, where:

- **KDF** is the execution engine and runtime-safe MM foundation,
- **KCB** is the control/orchestration backend,
- **GUI** is the operator-facing frontend,
- richer market-making behavior is introduced gradually,
- KDF is improved upstream in carefully chosen areas,
- higher-level policy and portfolio logic stay outside KDF.

The target is **not** to turn KDF into a full external-strategy platform, and **not** to turn the GUI into a trading engine.

---

## 4. Fixed architecture (must be treated as fixed by default)

This architecture is **fixed by default**. Any proposal that changes it, adds another component at the same architectural level, or significantly redistributes responsibilities must be treated as an **architecture-level change request**, not as a routine refactor.

If a future proposal would alter this level of architecture, it must be flagged explicitly and treated as requiring explicit human approval.

## 4.1 High-level architecture

### A. KDF
**KDF is the execution engine.**

KDF is responsible for:
- wallets,
- coin activation,
- orders,
- swaps,
- native simple MM primitives,
- native runtime status/telemetry,
- execution-near market-making safety and lifecycle features.

KDF is **not** the GUI.
KDF is **not** the operator UX layer.
KDF is **not** the main home for portfolio/policy strategy logic.

---

### B. KCB (Komodo Control Backend)
**KCB is the control/orchestration backend.**

For the current phase:
- KCB exists only as a **logical layer inside the backend of the Next.js application**.
- It is **not yet** a standalone deployable service.

KCB is responsible for:
- business/runtime configuration handling,
- coin definitions fetching/caching,
- capability resolution,
- bootstrap config read/write/validate/apply,
- command execution queue,
- control-plane operations,
- acting as the only control layer between GUI and KDF.

KCB should be implemented so that it could later be extracted into a standalone service with minimal redesign.

---

### C. GUI
**GUI is the operator-facing frontend.**

GUI is responsible for:
- displaying state,
- displaying orders,
- displaying wallets,
- displaying movement/transaction views if backend support exists,
- editing KCB-managed configuration,
- triggering KCB actions,
- showing command queue state,
- showing KDF/KCB operational status.

GUI must **not** directly control KDF.

---

## 4.2 Control boundary rule

The fixed rule is:

- **GUI controls KCB**
- **KCB controls KDF**

Not:
- GUI controls KDF directly.

That means:
- direct GUI-to-KDF control paths should be removed or considered legacy compatibility only,
- direct admin operations (for example restart) must go through KCB command handling.

---

## 4.3 Current physical deployment model

For the current phase:

- KDF is a separate external runtime/service.
- GUI + KCB live in one Next.js application.
- KCB is a **logical** layer, not yet a separate process.

This means:

- there are logically **three layers**,
- but currently only **two deployed applications/processes**:
  1. KDF
  2. Next.js app (GUI + KCB backend)

This is intentional and currently fixed.

---

## 4.4 Execution split (fixed)

The architecture establishes a **KCB-strategy / KDF-execution split**.

This means:

- KCB owns the strategy loop: it decides what orders to place, when to update them, and when to cancel them,
- KDF is the execution engine: it manages wallets, activates coins, places and manages orders, and handles swaps,
- higher-order strategy and portfolio logic belongs in KCB, not in KDF.

The split is analogous to the Hummingbot model: the strategy layer owns market-making decisions, the exchange connector executes them. KCB is the strategy layer; KDF is the connector.

This architecture is already chosen and should be treated as fixed by default.

---

## 4.5 Feature split by architectural ownership (fixed)

### Category 1 — Must be in KDF
These are engine-near, safety-critical, runtime-state-sensitive, or too dangerous/racy to manage externally.

These are fixed as **KDF-side responsibilities**:

- cross-pair inventory awareness
- global exposure limits
- pause / resume / circuit breaker
- hot config reload
- price provider abstraction
- structured status / telemetry
- multi-order primitives

### Category 2 — May be in KDF later
These are possible later KDF additions, depending on maintainers, usefulness, and implementation practicality.

Examples:
- basic multi-level quoting helper
- per-pair error counters and auto-disable
- partial config update RPC
- lease / heartbeat safety mechanism

### Category 3 — Must stay outside KDF
These remain outside KDF by design.

Examples:
- advanced trading models
- portfolio allocation and rebalancing
- external exchange integrations
- strategy composition frameworks
- GUI / admin / orchestration logic

This split is fixed unless explicitly changed with approval.

---

## 4.6 Important rule about future architectural changes

If a future proposal does any of the following, it must be treated as an architecture-level change:
- adds a new major component at the same level as KDF / KCB / GUI,
- moves control responsibility from KCB back into GUI,
- moves portfolio/policy logic into KDF,
- turns KCB into a standalone service,
- collapses KCB responsibilities into GUI,
- creates direct GUI-to-KDF control paths again.

Such proposals must be explicitly flagged and must not be assumed acceptable by default.

---

## 5. Current implementation priorities (fixed for the current phase)

The current phase is **not** about deep KDF changes.
The current phase is about finishing the first usable stack and validating it in practice.

### Current priority order
1. complete the first practical version,
2. create test infrastructure,
3. validate architecture on a real VM,
4. test already implemented KDF changes,
5. only then explain the broader plan to Komodo maintainers,
6. only then, with at least no explicit maintainer objection, move toward deeper KDF changes.

This order is fixed for now.

---

## 6. Current phase scope

The current phase aims to achieve all of the following:

- practical deployment on a Linux VM,
- KDF running as execution engine,
- GUI/KCB running as a Next.js app,
- coin definitions fetched/cached automatically,
- bootstrap config editable without manual shell/json work,
- bootstrap apply through KCB,
- market-making startup through KCB,
- online monitoring through GUI,
- parameter changes through GUI/KCB,
- command queue visibility and debugging,
- no deeper KDF modifications for this phase.

---

## 7. Coin definitions and external metadata (fixed direction)

## 7.1 Coin definitions source
Coin definitions should be fetched from the official raw source, not manually maintained inside the app.

Current chosen direction:
- fetch `coins_config.json` from the configured raw URL,
- cache it locally,
- allow manual refresh,
- auto-fetch only when the local cache is missing.

Current agreed source:
- `https://raw.githubusercontent.com/GLEECBTC/coins/refs/heads/master/utils/coins_config.json`

Icons:
- use the icons repository path as source
- treat icons as cache, not source of truth

Current source directory:
- `https://github.com/GLEECBTC/coins/tree/master/icons`

## 7.2 Why not `git clone` in this phase
The current decision is to **not require `git clone`** in the first version.

Reason:
- raw JSON fetch + cache is simpler,
- enough for the current phase,
- easier to operate,
- easier to validate,
- lower coupling.

A future move to repository clone/snapshot workflow remains possible, but is not the current plan.

---

## 8. Capability model (fixed short-term direction)

The GUI/KCB must not hardcode all available behavior forever.
It needs a **capability model**.

The purpose of this model is to define **where the GUI/KCB learns what features are supported**, especially:

- which trading strategies are available,
- which KDF features are enabled,
- how configuration should be validated,
- how GUI should adapt to the specific KDF build/runtime.

This is critical because:
- KDF evolves,
- not all features are always available,
- GUI must not expose unsupported functionality,
- we want to avoid tight coupling between GUI and a specific KDF versio

### Evolution paths — not yet decided

Two capability evolution paths are under consideration. Neither has been finalized. Phase C is the active phase for now.

---

#### Path 1: Original evolutionary path

The original staged approach moves capability ownership progressively from KCB toward KDF:

- **C**: GUI/KCB-local capabilities file
- **B1**: a capabilities JSON as a part of the KDF repo (either as a static file or generated during build as B2)
- **A**: capabilities exposed directly via KDF API

C → B1 → B2 → A

This path depends on KDF maintainer cooperation at the B1/B2/A stages. It is not fixed whether this path is walked to its end.

---

#### Path 2: Capability-config encapsulation (C2)

An alternative is to remain with a **local capabilities file** (phase C), but design it to serve as a **stable indirection layer** between KCB internal logic and KDF API calls.

In this model:

- KCB code uses stable internal capability identifiers (e.g. `activate_coin`, `place_order`),
- the capabilities config JSON maps each identifier → the specific KDF RPC method name, API version, and parameter shape to use,
- each KCB-to-KDF call can be individually enabled, disabled, or rerouted via config,
- the config file is owned and distributed as part of KCB — no KDF repo contributions required.

This approach:

- maintains architectural cleanliness,
- allows KCB to target multiple KDF versions without code changes,
- allows the operator to adjust which KDF features are used without rebuilding KCB,
- avoids the maintainer-dependency risk of Paths B1/B2/A.

**Implementation guideline:** When writing code that calls KDF, structure each call so that the RPC method name, parameter shape, and API version can be resolved from configuration rather than hardcoded. This does not require implementing the indirection mechanism now — it only keeps the code shape compatible with inserting it later.

**This path is not yet implemented. It is described here as a candidate future direction only.**

---

#### Decision status

The final choice between Path 1 and C2 has not been made. For now, Phase C is the active implementation target. Code should be written in a way that keeps both paths viable.


### C (Current phase) — Local Capabilities (GUI/KCB-owned)
KCB/GUI uses a local capabilities manifest.
This is the currently chosen solution because:
- it avoids immediate KDF changes,
- it avoids API expansion in KDF,
- it keeps control in our hands while architecture is still being tested.

#### Responsibilities
KCB:
* loads capabilities file,
* exposes it via API,
* uses it for validation.

GUI:
* uses capabilities to:
  * render forms,
  * enable/disable features,
  * validate user input.

#### Advantages
* Zero dependency on KDF maintainers
* Fast iteration
* Ideal for experimentation
* Works even if KDF lacks metadata

#### Disadvantages
* Not authoritative (can drift from real KDF behavior)
* Requires manual maintenance
* Risk of mismatch between GUI and KDF

### B1 — Static Capabilities JSON in KDF Repository
KDF capabilities are stored and maintained as a static JSON in KDF Repository.
KCB reads them and uses them when communicating with KDF.

### B2 — Capabilities Generated Dynamically 
The KDF capabilities are dynamically generated as a JSON from its source code during the build.
Otherwise similar to B1.

### A — Capabilities via KDF API (Runtime)
Capabilities are exposed directly via KDF RPC/API.


### Important rule
Do NOT move to next phase unless:

* KDF maintainers agree,
* architecture is validated,
* requirements are stable.

### What must NOT happen

The following are strictly disallowed:

* Hardcoding capabilities permanently in GUI without a data model
* Mixing capability logic into .env.local
* Making GUI assume KDF features without validation
* Skipping directly to API-based capabilities (Phase A) without prior validation
* Creating multiple conflicting capability sources at once
* Embedding business strategy logic into capability definitions

### Current implementation expectation

At the current phase, the system must:

* load capabilities from `~/.kcb/config/kdf-capabilities.local.json`
* expose them via KCB API
* use them in GUI for:
  * feature availability
  * form validation
  * configuration constraints

If the file is missing, the system should either:
* use a safe minimal default, or
* fail clearly (implementation choice to be defined)

---

## 9. KCB storage model (fixed current direction)

## 9.1 Default root
KCB stores business/runtime state under:

- default: `~/.kcb`
- override: `KCB_CONFIG_DIR`

### Fixed rule
- the KCB **root directory must already exist**
- KCB may create/manage **subdirectories and files inside it**
- if the root directory is missing, KCB should fail clearly

This is the desired runtime behavior.

### Build-time rule
KCB runtime directories must **not** be created during `npm run build`.

Reason:
- build is not runtime initialization,
- build may run under a different user/environment,
- runtime state must be managed at runtime, not at build time.

---

## 9.2 KCB directory layout
The agreed layout is:

```text
~/.kcb/
  config/
    bootstrap-config.json
    kdf-capabilities.local.json
    coin-sources.json
    gui-policy.json            # optional if needed later
  cache/
    coins/
      coins_config.json
      coins_config.meta.json
    icons/
      ...
  state/
    commands.json
    bootstrap-status.json
    last-apply.json
    resolved-capabilities.json
  logs/
    ...
```

This directory structure is part of the agreed direction.

## 10. KCB configuration and operational boundaries (fixed)
## 10.1 .env.local

.env.local is for operational/runtime parameters only.

It may contain:

* RPC URLs
* secrets
* ports
* log level
* timeouts
* polling interval
* KCB config dir path
* source URLs
* restart mode / service names / script paths

It must not contain:

* business logic
* strategy behavior
* trading policy
* market bootstrap logic
* detailed MM parameters

### Important operational values

Examples:

* KCB_CONFIG_DIR
* KCB_COINS_CONFIG_URL
* KCB_ICONS_BASE_URL
* KCB_HTTP_TIMEOUT_MS
* KCB_LOG_LEVEL
* KCB_COMMAND_RETENTION_SECONDS
* KDF_RPC_URL
* KDF_RPC_USERPASS
* restart-related variables

## 10.2 Business/runtime config

Business/runtime config belongs in KCB-managed config/state files under ~/.kcb, not in .env.local.

This includes:

* bootstrap config
* local capability definitions
* coin source config
* resolved state snapshots
* KCB-managed business/runtime declarations

## 11. KCB command executor (fixed current direction)

The current agreed model is a lightweight command executor, not a full job platform.

## 11.1 Required properties
* serial execution
* priority support
* command status tracking
* retention cleanup
* command observability in GUI

## 11.2 Command data requirements

Each command must include at least:

* id
* type
* priority (high or normal)
* status (queued, running, done, failed)
* created_at
* finished_at (set on both success and failure)
* optional summary/result
* optional error message

11.3 Priority model

Two priority levels are currently agreed:

* high
* normal

This does not require two physically separate queue implementations.
It only requires the behavior to be clearly represented and visible.

## 11.4 Cleanup behavior

A cleanup job must remove closed commands (done / failed) after a retention period.

Retention:

* controlled by KCB_COMMAND_RETENTION_SECONDS
* default: 30 seconds

This cleanup should exist and be observable.

## 11.5 GUI visibility

GUI must regularly poll and display command state.
A dedicated screen for queue/command state must exist.

The GUI must show:

* queued/running/done/failed
* created_at
* finished_at
* command type
* priority
* result/error summary

## 11.6 Read path rule

Read/status API calls must not go through the command queue.
The queue is for write/control commands only.

## 12. Current KCB responsibilities (fixed for now)

KCB is the only layer inside the app responsible for controlling KDF.

That includes:

* bootstrap apply
* restart routing
* coin definitions refresh
* KDF control operations
* command execution
* desired/effective config handling

GUI must not directly perform these controls.

## 13. Current practical test domain

The immediate testing target is not Rincoin itself yet.
For practical bootstrap and validation, the current test domain is:

* DOC
* MARTY

Use cases:

* activate DOC/MARTY
* start simple MM on DOC/MARTY
* inspect command queue and KDF/KCB state
* validate restart/apply/status flows

This is the current practical test setup.

## 14. What the application must eventually achieve

At the end, the application should support this full practical workflow:

* operator deploys KDF and the GUI/KCB app,
* operator configures KCB storage and environment,
* KCB can fetch and cache coin definitions,
* GUI can edit KCB bootstrap config,
* KCB can apply that bootstrap config to KDF,
* KCB can activate selected coins,
* KCB can start/stop/configure MM behavior through KDF-supported primitives,
* GUI can show online status and command execution state,
* the operator can adjust parameters without manually editing JSON/bash each time,
* the system is testable, debuggable, and stable enough to support a real first liquidity market.

## 15. Immediate development objective for the AI assistant

When reviewing the codebase and proposing next steps, the AI assistant should optimize for:

* correctness of the fixed architecture,
* practical operability,
* reduction of manual steps,
* safe bootstrap and control flow,
* improving observability,
* preparing the system for real-world VM testing,
* validating existing KDF modifications,
* minimizing unnecessary architectural churn.

The AI assistant should not optimize for:

* adding exciting features,
* introducing new architectural layers,
* moving too fast into advanced strategy logic,
* overengineering.

## 16. Strict NO-GOs

The following are strict NO-GOs unless explicitly approved later.

## 16.1 Architectural NO-GOs

Do NOT:

* introduce a new standalone service for KCB in this phase,
* add another major component at the same architectural level,
* bypass KCB and let GUI control KDF directly,
* collapse KCB into GUI logic,
* move portfolio/policy strategy logic into KDF,
* redesign the architecture without explicit approval.

## 16.2 Product/feature NO-GOs

Do NOT:

* implement advanced strategy loops yet,
* implement portfolio-level logic,
* implement lease/heartbeat logic yet,
* add deeper KDF modifications in this phase,
* add database persistence unless absolutely necessary,
* introduce a heavy distributed job/task system,
* add authentication as a major subsystem now,
* redesign the GUI into a full trading terminal,
* add flashy visual work that distracts from operability.

## 16.3 KDF NO-GOs for the current phase

Do NOT:

* add new KDF features in this step,
* redesign KDF APIs now,
* force capability discovery into KDF now,
* implement major KDF market-making expansions before infrastructure validation.

## 16.4 Configuration NO-GOs

Do NOT:

* put business/trading logic into .env.local,
* require manual insertion of electrum server details into runtime bootstrap repeatedly,
* use npm run build to create runtime business/state directories.

## 17. Open questions / uncertainties

These are known unresolved or partially unresolved areas that must be treated explicitly.

## 17.1 KCB extraction timeline

KCB is currently a logical layer inside Next.js backend.
Future extraction into a separate service is possible, but not currently approved or scheduled.

Open question:

* when, if ever, should KCB become a standalone deployable service?

This must not be assumed automatically.

## 17.2 Capability evolution path

The long-term path is not yet fixed. Two candidates are under consideration: the original C → B1 → B2 → A evolutionary path (see §8 Path 1) and the C2 capability-config encapsulation approach (see §8 Path 2).

Open questions:

* which path should be finalized, and when?
* if C2: what is the correct granularity for capability identifiers?
* if C2: should the capabilities config be user-editable or operator-editable only?
* if Path 1: when should the local capabilities file be replaced by a KDF-owned source?
* how much capability data should be build-time vs runtime in either path?

## 17.3 Coin source policy

Current plan:

* raw JSON fetch + local cache

Open questions:

* when should repository snapshot pinning be introduced?
* do we want hash/etag pinning?
* how should icon caching mature over time?

## 17.4 KCB queue persistence/concurrency model

Current queue is intentionally lightweight and likely single-instance oriented.

Open questions:

* when does process-local locking become insufficient?
* do we eventually need stronger file locking or a more durable local store?
* at what point would a database become justified?

## 17.5 Exact scope of first “market-making complete enough” version

The current immediate goal is clear, but there is still some uncertainty about:

* how much parameter editing must be available before the first real Rincoin deployment,
* how much diagnostics must exist before maintainers are approached,
* how much of the bootstrap must be fully idempotent vs “practically idempotent”.

## 17.6 Future strategy boundary

The broad split is fixed:

* engine-near runtime features in KDF,
* higher-order policy outside KDF

But open questions remain about edge cases:

* how much multi-level quoting primitive belongs in KDF?
* where exactly does “helper primitive” end and “strategy” begin?
* how much of strategy execution should remain in KCB vs future external modules?

These questions should be handled cautiously and explicitly later.

## 18. Current recommended next-step evaluation criteria

When AI reviews the current code and proposes next steps, it should evaluate the code against these questions:

1. Does the code respect the fixed GUI -> KCB -> KDF control chain?
2. Is KCB truly isolated as a logical backend layer?
3. Are KCB-managed files/config/state in the correct place and correctly separated from env/runtime params?
4. Does KCB own bootstrap/apply/restart consistently?
5. Does command execution behave as agreed?
6. Are coin definitions fetched/cached as agreed?
7. Are read paths separate from command paths?
8. Is the current stack ready for practical VM validation?
9. What is still missing before the first real market-bootstrap test?
10. Which next steps improve the current phase without violating NO-GOs?

## 19. What the AI assistant should produce after reviewing the code

After reviewing the current codebase, the AI assistant should produce:

1. a gap analysis versus this architecture,
2. a list of mismatches or violations,
3. a list of missing pieces required for the current phase,
4. a prioritized next-step plan,
5. explicit warnings if any proposed step would violate the fixed architecture,
6. a strict distinction between:
   * “must fix now”
   * “nice to have”
   * “future / not now”

## 20. Final summary

This project is building a stratified operator stack for market making, with KCB owning strategy and orchestration and KDF handling execution.

The fixed structure is:

* KDF = execution engine
* KCB = control/orchestration backend (currently inside Next.js backend)
* GUI = operator frontend

The current phase is about:

* making the first version practical,
* proving the architecture,
* validating the stack on a real VM,
* testing the first KDF changes already made,
* avoiding deeper KDF modifications until the infrastructure is proven.

The AI assistant must respect this architecture, avoid NO-GOs, and propose only steps that help finish and validate this current phase.

## Very important instruction for the AI assistant

If any proposed next step would:

* alter the fixed architecture,
* add a new major component,
* move responsibilities across the fixed boundaries,
* or implicitly redesign the stack,

it must be called out explicitly as an architecture-level change and not proposed as an ordinary incremental step.