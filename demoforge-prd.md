# PRD: DemoForge (working title)

**An LLM-driven web product demo automation framework**

| | |
|---|---|
| Status | Draft v0.1 |
| Author | Matt Davis |
| Date | 2026-07-03 |
| Target | Open-source core + optional hosted tier |

---

## 1. Problem Statement

Every web product needs demo content: walkthrough videos, annotated screenshots, animated GIFs for READMEs, marketing-site hero clips, and documentation imagery. Today this content is produced manually — a human drives the app while screen-recording, then edits in a video tool. The result is expensive to produce, immediately stale after the next UI change, inconsistent across releases, and rarely regenerated.

Meanwhile, the product under demonstration is *already running locally* in dev and CI. The information needed to produce a good demo — what the product does, what its key flows are, what's visually interesting — is discoverable by an agent with browser access and a language model.

**DemoForge turns a locally running web application into finished demo assets (videos, screenshots, GIFs, and static demo sites) automatically, using a local LLM served by llama-server to plan and narrate the demo.**

## 2. Goals & Non-Goals

### Goals
1. Point the tool at a local URL (`demoforge run http://localhost:3000`) and receive polished demo assets with minimal configuration.
2. Use a **local LLM via llama-server** (OpenAI-compatible API) as the planning/narration brain — no cloud dependency required, no product data leaves the machine.
3. Produce **deterministic, replayable demo scripts** so assets can be regenerated in CI on every release without re-invoking the LLM.
4. First-class output types: MP4/WebM video, annotated PNG screenshots, animated GIF/WebP clips, and a static "demo site" (HTML gallery of flows with captions).
5. Seeded/fixture-aware: integrate with the app's seed data or a fixtures hook so demos show realistic, attractive content instead of empty states.

### Non-Goals (v1)
- Not a general-purpose browser agent or RPA tool (no form-filling for third-party sites, no scraping).
- Not an E2E testing framework — though the replay layer intentionally resembles one, assertions are out of scope for v1.
- No cloud rendering service in v1 (architecture should not preclude it).
- No AI-generated synthetic UI — everything captured is the real product, pixel-accurate.

## 3. Users & Use Cases

**Primary persona: solo founder / small product team.** Ships weekly, has zero video-editing budget, needs the landing page and docs to always match the current UI.

| Use case | Output |
|---|---|
| Landing-page hero clip | 15–30 s MP4/WebM, no chrome, smooth cursor |
| Feature walkthrough for docs | 60–120 s video with TTS or caption narration |
| README media | GIF/WebP under 5 MB per flow |
| Release notes visuals | Before/after screenshots of changed screens |
| Interactive demo gallery | Static HTML site: one page per flow, embedded clips + captioned stills |
| CI regression of demo assets | Regenerate everything on tag push; fail if a flow breaks |

## 4. Product Overview

### 4.1 The two-phase model (core architectural decision)

**Phase 1 — Exploration (LLM-driven, run occasionally).**
An agent loop drives a real browser against the local site. Each turn, the framework serializes the current page (accessibility tree + DOM digest + optional screenshot for VLM-capable models) and asks the LLM to choose the next action from a constrained action space. The LLM also emits *narrative intent* ("Now we open the camera settings to show retention policies"). The output of exploration is not a video — it is a **Demo Script**: a declarative, human-editable YAML/JSON document of steps, selectors, waits, camera directives, and narration text.

**Phase 2 — Rendering (deterministic, run constantly).**
A renderer replays the Demo Script against the app with no LLM in the loop: stable timing, synthetic smooth cursor movement, scripted scrolls, highlight/zoom effects, and capture via CDP screencast or headed-browser recording. Output is piped through an ffmpeg pipeline into final assets.

Why this split matters:
- **Reproducibility** — same script, same video, every release.
- **Cost/latency** — the LLM runs once per flow authoring session, not per render.
- **Editability** — humans can tweak a step, reorder, or fix a selector without re-exploring.
- **CI-friendliness** — rendering needs only a browser + ffmpeg, no GPU/LLM.

### 4.2 Demo Script (the central artifact)

```yaml
demo: camera-onboarding
title: "Add your first camera"
viewport: { width: 1440, height: 900, scale: 2 }
narration_mode: captions   # captions | tts | none
steps:
  - goto: /dashboard
    settle: networkidle
  - narrate: "From the dashboard, click Add Camera."
  - hover: { role: button, name: "Add Camera" }
    effect: highlight
  - click: { role: button, name: "Add Camera" }
  - fill:
      target: { label: "RTSP URL" }
      value: "rtsp://demo:demo@192.168.1.50/stream1"
      typing: natural        # human-paced keystrokes
  - screenshot: { name: add-camera-modal, annotate: [target] }
  - click: { role: button, name: "Save" }
  - wait_for: { text: "Camera online" }
  - narrate: "The stream appears within seconds."
  - pause: 2.5
```

Selectors prefer **role/name (accessibility) semantics** over CSS, with CSS/XPath fallback and an auto-heal pass (see 6.4).

### 4.3 LLM integration (llama-server)

- Talks to any OpenAI-compatible endpoint; llama-server is the reference target. Configurable base URL, model name, context budget.
- **Constrained decoding**: the action space is enforced via llama-server grammar (GBNF) or `response_format: json_schema`, eliminating malformed tool calls — a major reliability win for smaller local models.
- **Two model roles**, independently configurable:
  - *Planner/driver*: picks actions from page state (text-only accessibility tree works with any strong instruct model; VLM optional for visual verification).
  - *Copywriter*: turns the step log into polished narration, captions, alt text, and demo-site copy. Can be the same model with a different system prompt.
- Context discipline: page state is compacted (pruned AX tree, visible-viewport bias, interactive-elements-first) to keep turns under a configurable token budget so MoE models with modest active params stay fast.
- Optional cloud escape hatch (Anthropic/OpenAI API) behind the same interface for users without local inference.

### 4.4 Capture & rendering pipeline

- **Browser layer**: Playwright over CDP. Headed mode in a virtual display (xvfb/Wayland headless) for pixel-perfect capture at 2x DPR.
- **Cursor synthesis**: real OS cursors don't record well; render a synthetic cursor with eased Bezier motion, click ripples, and configurable style.
- **Effects**: zoom/pan (Ken Burns on the viewport), element spotlight/dim, callout labels, smooth scroll easing.
- **Encoding**: ffmpeg pipeline → H.264 MP4 + VP9/AV1 WebM; palette-optimized GIF and animated WebP with size budgets.
- **Audio**: optional TTS narration (pluggable: Piper/Kokoro locally, cloud voices optionally) with per-step timing alignment; or burned-in/sidecar captions (SRT/VTT).
- **Screenshots**: full-page and element-scoped, with annotation primitives (arrows, boxes, blur-redaction for sensitive regions).

### 4.5 Demo site generator

`demoforge site` compiles all rendered flows into a static site: index of flows, per-flow page with video, step-by-step captioned stills, and copyable narration. Themeable, deployable to any static host. This doubles as living, always-current product documentation.

## 5. CLI & Developer Experience

```
demoforge init                      # scaffold demoforge.yaml
demoforge explore <url> [--goal "show the billing flow"]
demoforge render [flow...]          # deterministic, no LLM needed
demoforge site                      # build static demo gallery
demoforge doctor                    # check browser, ffmpeg, llama-server health
demoforge heal                      # LLM-assisted selector repair after UI changes
```

Config (`demoforge.yaml`) covers: LLM endpoints, viewport/theme matrix (light/dark), seed-data hook command, redaction rules, output formats and size budgets.

**CI integration**: a GitHub Action that runs `render` (and optionally `heal`) on release tags, commits/uploads assets, and fails loudly when a flow can no longer replay — which is itself a smoke test of the product.

## 6. Functional Requirements

### 6.1 Exploration agent
- FR-1: Serialize page state as compacted accessibility tree + URL + title + recent-action history each turn.
- FR-2: Action space (grammar-enforced): `goto, click, hover, fill, select, press, scroll, wait_for, narrate, screenshot, mark_flow_start, mark_flow_end, done`.
- FR-3: Accept a natural-language goal ("demonstrate creating and sharing a report") or run in discovery mode (map the app, propose flows, ask for confirmation).
- FR-4: Guardrails — allowlist origin(s) only, block destructive verbs by default (configurable denylist of buttons/routes, e.g. "Delete account"), hard step and time budgets.
- FR-5: Emit a valid Demo Script plus an exploration transcript (for debugging model decisions).

### 6.2 Renderer
- FR-6: Byte-stable replays given identical app state; per-step and global timeout policies with actionable failure output (screenshot + AX diff at failure point).
- FR-7: Render matrix: viewport sizes × color schemes × locales from one script.
- FR-8: Deterministic clock/animation control where possible (CDP virtual time as an option) to stabilize animated UIs.

### 6.3 Outputs
- FR-9: MP4 (H.264), WebM (VP9/AV1), GIF, animated WebP, PNG stills, SRT/VTT captions, optional TTS audio track.
- FR-10: Size budgets enforced per format with automatic fps/scale negotiation (e.g., "GIF ≤ 5 MB").

### 6.4 Maintenance
- FR-11: `heal` mode — on replay failure, invoke the LLM with the failing step, old selector, and new AX tree to propose a selector patch as a reviewable diff. Never auto-commit silently.
- FR-12: Diff report between renders across versions (per-step SSIM/pixel-diff) to surface unintended UI changes.

## 7. Architecture

```
┌─────────────┐   OpenAI-compat API    ┌──────────────────┐
│ llama-server │◄──────────────────────│  Explorer Agent  │
│ (local LLM)  │  grammar-constrained  │  (plan + narrate)│
└─────────────┘                        └────────┬─────────┘
                                                │ emits
                                        ┌───────▼────────┐
                                        │  Demo Script    │  (YAML, versioned in repo)
                                        └───────┬────────┘
                                                │ consumed by
┌─────────────┐      CDP / Playwright   ┌───────▼────────┐      ┌──────────────┐
│ Local web   │◄────────────────────────│    Renderer     │─────►│ ffmpeg / TTS │
│ app (any)   │                         │ (deterministic) │      │   pipeline   │
└─────────────┘                         └───────┬────────┘      └──────┬───────┘
                                                │                      │
                                        ┌───────▼──────────────────────▼───────┐
                                        │  Assets: MP4/WebM/GIF/PNG/VTT + Site │
                                        └──────────────────────────────────────┘
```

**Implementation stance (proposed):** core in TypeScript (Playwright-native, easiest ecosystem adoption) with the renderer and ffmpeg orchestration as a separable package; Rust considered for the capture/compositing hot path later if the synthetic-cursor compositor needs to move off the DOM. LLM client is a thin adapter — no framework lock-in (no LangChain-class dependency).

## 8. Performance & Quality Targets

- Exploration: ≤ 2 s median per LLM turn on a 30B-class MoE at 32K context (local, single consumer/workstation GPU); a 10-step flow authored in under 3 minutes.
- Render: a 60 s 1440p demo renders in ≤ 2× real time on CPU-only CI.
- Replay flake rate < 1% across 100 consecutive CI renders of a stable app.
- Zero network egress in fully-local mode (verifiable; a compliance selling point).

## 9. Risks & Open Questions

1. **Small-model planning quality.** Mitigations: grammar constraints, AX-tree compaction, goal decomposition, and a human-in-the-loop confirm step after discovery. Open: how much does a VLM improve step quality vs. text-only AX trees?
2. **Selector fragility** across releases. Mitigated by role/name selectors + `heal`, but healing on heavily dynamic UIs (canvas apps, virtualized lists) is genuinely hard. Canvas-based apps may be out of scope for v1.
3. **Empty-state problem.** Great demos need great data; the fixtures hook is a contract with the app developer. Should v1 ship opinionated seed helpers for common stacks (Django, Rails, Next/Prisma)?
4. **Animated/nondeterministic UIs** (live charts, websockets). Virtual time helps; may need a "record N takes, pick best by stability score" fallback.
5. **TTS licensing/quality** for the local path — Piper is easy, quality is mid; Kokoro-class models better but heavier.
6. **Positioning**: adjacent to browser-use/Stagehand (agents), Playwright trace viewer (testing), Screen Studio/Arcade (manual demo tooling). The wedge is *automated, regenerable, local-first* demo assets — nobody owns "demos as code" yet.

## 10. Milestones

| Milestone | Scope |
|---|---|
| M0 — Spike (2 wk) | Renderer only: hand-written Demo Script → MP4 with synthetic cursor. Proves the capture pipeline. |
| M1 — Explorer (4 wk) | llama-server agent loop, grammar-constrained actions, script emission, one real app end-to-end. |
| M2 — Polish (4 wk) | Effects (zoom/highlight), captions, GIF/WebP budgets, screenshot annotation, `doctor`. |
| M3 — Lifecycle (4 wk) | CI action, `heal`, render matrix, diff reports, demo-site generator. |
| M4 — Launch | OSS release, docs, dogfood assets produced by the tool itself. |

## 11. Success Metrics

- Time from `init` to first finished video on a new project: **< 15 minutes**.
- ≥ 3 real products regenerating demo assets in CI within 90 days of launch (dogfooding counts).
- Community signal: script-format PRs/issues from non-authors, indicating "demos as code" resonates.
