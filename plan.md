# HUMAN LLM — Build Plan

> A gallery installation where a crowd of humans performs next-word prediction. The "model" is the room. Each response is generated one word at a time through collective voting. Slowness is a feature, not a bug.

---

## Concept

A user submits a prompt. Instead of an LLM generating the response, the system asks humans to vote on the next word. Each token is a separate ballot. When a ballot closes, the winning word locks in and the next ballot opens. Responses can take hours or days to complete. The piece is meant to be experienced live in a gallery, with the response visibly materializing on a wall display as voters (in-room and possibly remote) participate via phones.

**Core artistic claim:** This makes legible the act of prediction — the collective uncertainty, the moment of consensus, the slowness of meaning being made by many hands. The wall display shows candidate words as a blurred, overlapping cloud that gradually resolves into a single word as votes accumulate.

---

## System Overview

Three surfaces, one backend.

1. **Gallery Display** (`/display`) — fullscreen wall view. Read-only. Shows the prompt, the locked-in response so far, and the current ballot's candidates emerging from noise as votes accumulate. This is the art object.
2. **Voter Interface** (`/vote`) — phone-optimized, loaded via QR code from the wall. Shows the current state and a single input: "what word comes next?" Plus tap-to-vote buttons for words others have already submitted. No login.
3. **Curator Console** (`/curator`) — password-gated. Submit new prompts to the queue, monitor active sessions, set ballot duration and vote thresholds, manually close ballots, moderate submitted words (hide slurs/spam), and reorder the queue.

---

## Visual Language

> **The interface is text on a flat surface. Nothing else.** No decoration, no chrome, no gradients, no accent colors, no icons, no warm tones. The text on the wall is the art; the interface around it should disappear.

The reference point is a plain text file, a `man` page, a 1990s academic homepage — not Craigslist (which is too designed by comparison), not editorial typography. The aesthetic is *system-honest*: the piece looks like what it is — data being collected and rendered — not dressed up as literature or art.

**Rules:**

- **One typeface only:** system monospace stack. `font-family: ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace`. No Google Fonts. Each environment shows its own monospace. This is more honest than a chosen "designed" mono like JetBrains Mono.
- **White background, black text.** `#fff` and `#000`. No warm tones, no off-white, no near-black. Stark.
- **No accent colors.** The current leader is not highlighted with gold or any color. It is simply at higher opacity than the others. Distinction is conveyed through opacity, not hue.
- **No borders, no boxes, no cards, no dividers.** Pure flow text on a flat field. Whitespace separates sections.
- **All labels are lowercase plain text.** `ballot 13` not `BALLOT 13 — OPEN`. `settling` not `STATE: SETTLING`. No tracking, no caps, no decorative formatting.
- **No icons, no QR styling, no logos.** The "scan to vote" URL is printed as plain text. Generate a QR if needed but render it small, monochrome, untreated.
- **No film grain, gradients, or backgrounds of any kind.**
- **Numbers are bare.** `14 votes` not `14 VOTES CAST` or fancy formatting.

**The earlier mockup (`human-llm-mockup.html`) is now obsolete.** Its Fraunces serif, gold accent, warm-black gradient, and film grain were exploratory. The new aesthetic supersedes them. A replacement mockup file (`human-llm-mockup-stark.html`) will be the reference for all three surfaces.

This stark approach applies to all three surfaces (display, voter, curator). They share one visual system.

---

## System Overview (revised note)

The three surfaces share the visual language above. Specifically:

1. **Gallery Display** — wall view. Black text on white, monospace, plain. The emergence visualization uses *opacity only* — no blur, no scale, no position changes, no color shifts. Each candidate word's opacity = its vote share. Leader is most opaque; long-tail candidates fade toward transparent. This is the most LLM-honest visualization possible: the probability distribution rendered directly as visible text weight.
2. **Voter Interface** — phone view. Same visual rules. Plain text input, plain tap targets (just words, no buttons or chips), state indicator in plain lowercase.
3. **Curator Console** — same visual rules. Functional density is higher (lots of controls) but the same stark monospace world.

---

## Data Model

```
Session
  id
  prompt: string
  status: queued | active | complete | abandoned
  created_at, started_at, completed_at
  config: BallotConfig   # see "Ballot Closure Logic" section below; copied from
                         # global defaults at session start, then editable per-session

Ballot
  id
  session_id (FK)
  position: int          # 0-indexed token position within the session
  status: open | closed
  opened_at, closed_at
  winning_word_id (FK, nullable until closed)

Word
  id
  ballot_id (FK)
  text: string           # normalized (trimmed, single token, lowercased for grouping)
  display_text: string   # what voter actually typed, preserves case
  vote_count: int (denormalized for display perf)
  is_hidden: bool        # moderation
  first_submitted_at

Vote
  id
  word_id (FK)
  voter_token: string    # anonymous, cookie-based, used for one-vote-per-ballot
  created_at
  source: gallery_qr | remote | curator
```

**Normalization rule:** "the", "The", "the " all collapse to the same `Word` row. Display the most-voted casing.

**Special tokens:** Include `[END]` as a votable option that closes the session. Optionally `[PARAGRAPH]` for line break. Curator can enable/disable.

---

## Ballot Closure Logic

> This is the most important logic in the system. The sequential nature of the piece means total response time is bounded by per-ballot time. Get this wrong and the gallery wall stalls or closes ballots before consensus forms. Get it right and the piece breathes — moving fast through obvious words, slowing thoughtfully at real choice points.

### Foundational Principle: Distribution-Driven, Not Time-Driven

The system is **watching the shape of voting, not the clock**. A ballot closes when the distribution has stabilized — when enough consensus has formed (or enough sample has accumulated) that further voting wouldn't meaningfully change the answer. This is a state of the *data*, not a state of time.

Timeouts exist only as **safety nets** to prevent the system from freezing on a no-vote or perfectly-deadlocked ballot. They are not the primary mechanism. In a healthy session, only ~5% of ballots should ever hit a timeout. The rest close on distribution conditions in 1-8 minutes naturally.

Two consequences flow from this:

- **No countdowns are shown to the audience.** The gallery display never displays a "closes in X:XX" timer. The audience sees consensus forming visually; the close happens when it happens. (The voter UI also avoids precise timers — only a qualitative state indicator.)
- **Timeouts can be disabled entirely.** For long-form or contemplative sessions where the artist wants ballots to remain open indefinitely until consensus forms, every timeout can be switched off in `BallotConfig`. The piece then runs purely on distribution conditions plus curator override.

### The Core Problem

A 30-word response at 5 minutes per word is 2.5 hours. The system's velocity is governed entirely by how confidently each individual ballot can resolve. Two failure modes to avoid:

- **Over-collecting on easy ballots:** Waiting 10 minutes for "the" when 8 of 8 voters already agreed in the first minute is wasted gallery time.
- **Under-collecting on hard ballots:** Closing a ballot at 8 votes when the leader has only 30% share means the "winner" is essentially random.

The solution is **adaptive closure** — ballots close based on the *state of consensus*, not a fixed vote count or timer.

### Statistical Basis

For a leader to be statistically robust (95% confident they'd still win if everyone voted), the required sample size scales inversely with the squared margin of victory. Rough numbers:

| Lead margin (leader % − runner-up %) | Votes needed for confidence |
|---|---|
| 50pp (landslide, e.g. 75/25)         | ~16 |
| 30pp (clear, e.g. 60/30)             | ~45 |
| 15pp (slim, e.g. 40/25)              | ~180 |
| 5pp  (genuine tie)                   | ~1600 |

Genuine ties are unresolvable by waiting. With temperature > 0 the sampler handles them naturally. At temperature 0 the system must accept this and handle it explicitly (extend, coinflip, or curator), not pretend more votes will fix it.

### Closure Conditions

A ballot closes the moment **any** enabled condition is true. Evaluated by the lifecycle worker every ~2 seconds. Each condition can be independently enabled or disabled.

**Distribution-driven (primary):**

1. **Landslide close.** Leader share ≥ `landslide_share` AND votes_cast ≥ `landslide_min_votes`.
   *Default: 70% share AND ≥6 votes.* Closes obvious function words fast. Disable with `landslide_enabled: false`.

2. **Confident close.** Leader share ≥ `confident_share` AND margin to runner-up ≥ `confident_margin` AND votes_cast ≥ `confident_min_votes`.
   *Default: 45% share AND 15pp margin AND ≥12 votes.* The standard close — clear shape, enough sample. Disable with `confident_enabled: false`.

3. **Vote ceiling.** votes_cast ≥ `max_votes`.
   *Default: disabled.* Optional safety to prevent runaway collection on a viral session. Enable with `max_votes_enabled: true`.

**Time-driven (safety nets, all optional):**

4. **Soft timeout.** `soft_timeout_seconds` elapsed AND votes_cast ≥ `min_votes_floor`.
   *Default: disabled.* When enabled, accepts whatever leader exists after the timeout. Suggested value if enabled: 25 minutes with ≥5 vote floor. Set `soft_timeout_enabled: false` to turn off entirely.

5. **Hard timeout.** `hard_timeout_seconds` elapsed regardless of vote count.
   *Default: disabled.* When enabled, forces close even on a no-vote ballot. Suggested value if enabled: 60 minutes. Set `hard_timeout_enabled: false` to turn off entirely.

**Manual:**

6. **Curator close.** Manual force-close from `/curator`. Always available, cannot be disabled.

> **Why timeouts default to off:** the piece is artistically committed to slowness. Days-long ballots are part of the work. The curator console gives full visibility into stalled ballots and a one-click force-close, so manual intervention covers the edge cases that timeouts would otherwise force. Enable timeouts only if running an unattended exhibition or if specific session pacing is required.

> Note: these conditions decide *when* to stop collecting votes. They do not pick the winner directly — that's the next step. With temperature > 0, even a clear leader is not guaranteed to win. Closure means "the distribution has stabilized enough to sample from it," not "we know the answer."

### Winner Selection: Temperature Sampling

This is the step that makes the piece behave like a real LLM rather than a vote-counting system.

When a ballot closes, the winner is **sampled** from the vote distribution, not chosen as the argmax. The temperature parameter controls how the raw vote shares are transformed into sampling probabilities.

**The math:**
Let `v_i` = vote count for candidate i, and `p_i = v_i / Σv` (the raw share).
Apply temperature transform: `p_i' = p_i^(1/T) / Σ(p_j^(1/T))`.
Sample one candidate from `p'`.

**How temperature shapes the piece:**

| Temperature | Behavior | Feel |
|---|---|---|
| `T = 0` | Argmax — always pick the leader | Deterministic, "the room's most common thought" |
| `T = 0.5` | Sharpened — leader heavily favored but minority can win | Coherent, occasional surprise |
| `T = 1.0` | Pure proportional sampling — votes ARE probabilities | **True to real LLMs at default settings** |
| `T = 1.5` | Flattened — long tail more likely to win | Strange, drifting, surreal output |
| `T → ∞` | Uniform random across all candidates | Pure chaos |

**Why this is the conceptual core of the piece:**

Real LLMs at temperature 1 sample proportionally from their probability distribution every single token. The "most likely" word doesn't always win — that's what makes their output feel alive rather than robotic. With argmax (T=0) every response would be the same; with temperature, each generation is a new draw from the same distribution.

Your piece, at T=1, faithfully models this. A word that 8 of 30 voters chose has a 27% chance of becoming the response, even if another word got 12 votes. This produces moments where the room is "leaning" one direction but the response goes another — *exactly* what happens inside an LLM, made visible and durational.

**Display treatment for sampling:**

When the ballot closes, the emergence visualization should show the sampling event clearly:
- Brief "SAMPLING" state where all surviving candidates pulse simultaneously
- A "draw" animation: candidates' visual weight briefly equalizes to their `p'` probabilities (post-temperature)
- The chosen word — which may or may not be the visual leader — illuminates and locks in
- Losers dissolve

This is dramaturgically important. The sampling moment is the LLM analogue of the dice-roll, and visibly showing that the leader doesn't always win is what teaches the audience what the piece is actually about. Don't hide it.

**Default temperature:** `1.0`. This is the LLM-faithful default. Curator can tune live. Some prompts may benefit from lower T (factual, focused responses) and others from higher T (surreal, exploratory). Worth experimenting per-session.

### Tiebreaker Logic

With temperature sampling, most "ties" resolve naturally — if two candidates are within a few percentage points, sampling gives each a near-equal chance. No special logic needed.

Tiebreakers only matter in two cases:

1. **T = 0 (argmax mode) with a literal tie.** Top two candidates have exactly equal vote counts. Strategies:
   - **Extend:** Keep ballot open another `tie_extension_seconds` (default: 3 minutes). Show "RUNOFF" state on display. Only allow votes for the top 2 candidates during extension.
   - **Coinflip:** Random pick between tied candidates. Logged.
   - **Curator decides:** Notify curator console; manual pick.
2. **Empty ballot.** No votes cast by hard timeout. Either abandon the session or curator force-picks. Should be rare with reasonable engagement.

`tie_threshold` (default: 0.02) defines what "tied" means at T=0 — top two within 2pp triggers tiebreaker logic. At T > 0, this field is ignored.

Default tiebreaker order for T=0: extend, then coinflip. Curator-only is opt-in.

### Pre-Staging (Critical for Velocity)

Once the current ballot has a *leader* at ≥`prestage_threshold` share (default: 50%), open a **provisional next ballot**. Voters can begin submitting and voting on word N+1, assuming that leader wins.

With temperature sampling, the leader is not guaranteed to win — so pre-staged ballots are *more* provisional than at T=0. Concretely:

- If the sampled winner matches the pre-staged condition: provisional ballot promotes to active instantly.
- If the sampled winner is a different candidate: provisional ballot's votes are invalidated. A fresh ballot opens for the actual context.

At T=0, pre-staging hits ~95% of the time (whoever leads, wins). At T=1, it hits ~60-70% of the time. Still a significant velocity win, but expect more "invalidated provisional" events. The display should communicate this cleanly: when a provisional ballot invalidates, show a brief "RECOMPUTING" state and fade the discarded votes.

Display treatment: provisional ballot appears below the active one, dimmer, labeled "IF 'morning' WINS →". Optional — can be disabled if the visual gets confusing.

### BallotConfig Schema

Every setting above is a tunable field on `BallotConfig`. Stored as JSONB on `Session` (per-session override) and as a singleton row in a `global_config` table (defaults).

```ts
type BallotConfig = {
  // Winner selection
  temperature: number;              // default 1.0
                                    // 0 = argmax (greedy), 1 = proportional sampling,
                                    // >1 = flattened, <1 = sharpened toward leader

  // Landslide close (distribution-driven)
  landslide_enabled: boolean;       // default true
  landslide_share: number;          // default 0.70
  landslide_min_votes: number;      // default 6

  // Confident close (distribution-driven)
  confident_enabled: boolean;       // default true
  confident_share: number;          // default 0.45
  confident_margin: number;         // default 0.15 (pp, expressed as fraction)
  confident_min_votes: number;      // default 12

  // Vote ceiling (safety net, optional)
  max_votes_enabled: boolean;       // default false
  max_votes: number;                // value if enabled (e.g. 200)

  // Soft timeout (safety net, optional, OFF by default)
  soft_timeout_enabled: boolean;    // default false
  soft_timeout_seconds: number;     // value if enabled (suggested 1500 = 25 min)
  min_votes_floor: number;          // default 5; only used when soft timeout enabled

  // Hard timeout (safety net, optional, OFF by default)
  hard_timeout_enabled: boolean;    // default false
  hard_timeout_seconds: number;     // value if enabled (suggested 3600 = 60 min)

  // Tiebreaker (only used when temperature == 0)
  tie_threshold: number;            // default 0.02
  tie_extension_seconds: number;    // default 180
  tiebreaker_strategy: 'extend_then_coinflip'
                     | 'extend_then_curator'
                     | 'curator_only'
                     | 'coinflip';  // default 'extend_then_coinflip'

  // Pre-staging
  prestage_enabled: boolean;        // default true
  prestage_threshold: number;       // default 0.50

  // Special tokens
  end_token_enabled: boolean;       // default true
  paragraph_token_enabled: boolean; // default false
  max_tokens_per_session: number;   // default 100 (hard stop on session length)
};
```

**Default config summary:** distribution-driven only. Both timeouts off. Vote ceiling off. The piece will keep a ballot open indefinitely until either (a) consensus forms naturally, or (b) the curator closes it manually. This is the artistically-pure default. Switch on timeouts only when needed.

### Resolution Order

Each ballot has a two-step lifecycle: **close** (stop collecting votes), then **select** (sample a winner).

**Step 1 — Closure evaluation** (every ~2s by the lifecycle worker). Disabled conditions are skipped entirely:
1. Hard timeout (if enabled) → close
2. Vote ceiling (if enabled) → close
3. Landslide (if enabled) → close
4. Confident close (if enabled) → close
5. Soft timeout (if enabled) → close
6. Curator manual close → close
7. Otherwise → keep open

With default config, only conditions 3, 4, and 6 are active. A ballot can stay open forever until consensus forms or the curator intervenes.

**Step 2 — Winner selection** (runs once when ballot closes):
1. If only one candidate exists → it wins (no sampling needed).
2. If `temperature == 0` and there's a literal tie within `tie_threshold` → run tiebreaker logic.
3. Otherwise → apply temperature transform to vote shares, sample one winner.
4. Promote pre-staged ballot if it matched the sampled winner; otherwise invalidate and open fresh ballot.

### Tuning In Practice

These defaults are starting points, not final values. The whole point of making them configurable is to tune in response to real session data. Expect to adjust based on:

- **Average votes per ballot at close.** Too low (<8 avg) → raise `confident_min_votes`. Too high (>30 avg) → lower thresholds, you're over-collecting.
- **Median time per ballot.** Healthy range is 1-8 minutes. Above 15 min median suggests engagement issue, not config issue.
- **Stalled ballot rate.** % of ballots that stayed open >30 minutes. Indicates contested moments. Some is interesting (a few per session feels alive); too many means thresholds may be too strict or engagement too low.
- **Timeout invocation rate** (only meaningful when timeouts are enabled). If soft timeout is firing >20% of the time, either lower thresholds or engagement is too low. If hard timeout fires at all, something is wrong — investigate.
- **Tiebreaker invocation rate.** Only meaningful at T=0. At T>0 should be near zero.
- **Words-per-hour.** Aim for 8-15 in a well-attended gallery. Below 5 = ballots too slow. Above 20 = probably closing too fast, sacrificing thoughtfulness.
- **"Upset rate"** — % of ballots where the sampled winner was not the vote leader. At T=1 with typical distributions this should be 20-40%. If near 0%, temperature is too low or distributions are too peaked. If above 60%, temperature is too high and responses will feel incoherent. This is the key metric for tuning *coherence vs surprise*.
- **Response coherence (subjective).** Walk through completed responses. Are they readable? Mostly grammatical? If too rigid/predictable → raise temperature. If too surreal/broken → lower temperature.

The curator console must expose all of these as live-editable controls during a running session, with safe-defaults reset.

### Engagement Levers (Non-Math)

The closure logic above assumes votes are arriving. If they aren't, no statistical tuning helps. Three product levers:

1. **Ballot-open notification.** Optional in-gallery sound (subtle bell) and optional push notification for voters who've opted in. Tunable per-session.
2. **Tap-first UI.** On the voter screen, candidate chips (sorted by votes) are the primary action — sub-second tap-to-vote. Free-text input is secondary, used only by the first few voters per ballot. Drastically reduces engagement latency.
3. **Pre-staging** (covered above) — the biggest win.

---

## Tech Stack

- **Frontend:** React + Vite. TypeScript. No CSS framework — hand-written CSS with the aesthetic from the mockup (Fraunces + JetBrains Mono, warm black, accent gold). Framer Motion for the emergence animation.
- **Backend:** Node + Fastify (or Hono). REST for mutations, Server-Sent Events for live updates to the display and voter interfaces. SSE is enough — no WebSockets needed.
- **DB:** Postgres. Use a single table for vote tallies; do the aggregation in SQL. Drizzle or Kysely for the query layer.
- **Hosting:** Fly.io (per existing setup). One app, one Postgres. Deploy via GitHub Actions on push to `main`.
- **Auth:** Curator console behind HTTP basic auth or a single shared password. Voters are anonymous (cookie-based token only).

---

## Build Order

### Phase 1 — Backend skeleton
1. Set up project: monorepo with `apps/web` and `apps/api`, or single Fastify app serving the Vite build. Single app is simpler — go with that.
2. Postgres schema + migrations (Drizzle).
3. Core endpoints:
   - `POST /api/sessions` (curator) — create a session with prompt
   - `GET /api/sessions/active` — currently active session (or null)
   - `GET /api/sessions/:id` — full session detail including all locked words and current ballot
   - `POST /api/ballots/:id/vote` — body `{ word: string }`; one vote per voter_token per ballot
   - `POST /api/ballots/:id/close` (curator or auto-triggered) — picks winner, opens next ballot
   - `GET /api/events` (SSE) — pushes ballot updates, new votes, ballot closures
4. **Ballot lifecycle worker:** A recurring job (every ~2s) that evaluates all open ballots against the closure conditions in *Ballot Closure Logic* above. On close, runs the tiebreaker if needed, picks the winner, opens the next ballot (or promotes the pre-staged one), and emits SSE events.
5. **Pre-staging logic:** When a ballot's leader crosses `prestage_threshold`, create the next ballot in `provisional` status. On parent close, promote or invalidate based on whether the leader held.
6. **Session lifecycle:** when a ballot's winning word is `[END]` (or `max_tokens_per_session` is reached), mark session complete and promote next queued session to active.

### Phase 2 — Voter interface
1. `/vote` page. Loads active session via API, subscribes to SSE for updates.
2. Three sections on screen:
   - Top: the prompt, in italic light
   - Middle: locked response so far, scrolling text
   - Bottom: the ballot — large text input + tap-buttons for existing candidates sorted by vote count
3. On submit: optimistic UI update (show your word in the candidate list immediately), POST vote, error fallback.
4. Voter token: generate UUID on first load, store in localStorage and as httpOnly cookie. Prevent duplicate votes per ballot.
5. Show "you voted for X" state with option to change vote until ballot closes.
6. **No countdown on the voter screen either.** Voters see the same qualitative state indicator as the wall (`GATHERING` / `FORMING` / `SETTLING` / `CONVERGED` / `CONTESTED`) so they have a sense of the ballot's state without being pressured by a timer. The piece is contemplative, not racing.
7. Profanity/slur filter: client-side soft filter (warn before submit), server-side hard filter (replace with `[removed]` or reject). Use a library like `bad-words` + a custom list. Curator can override.

### Phase 3 — Gallery display
1. `/display` page. Fullscreen, no controls visible. Subscribes to SSE.
2. Implement the opacity-only emergence visualization per the *Visual Language* and *Visual & Interaction Specifications* sections. Candidates are a plain vertical monospace list; opacity = vote share; no blur/scale/color/position effects.
3. **No countdown timer is ever shown.** The audience must not be able to anticipate when a ballot will close.
4. **Qualitative state indicator** in lowercase plain text below the candidate list: `gathering` / `forming` / `settling` / `converged` / `contested`.
5. **Sampling animation** on ballot close: candidates briefly equalize to temperature-adjusted probabilities, sampled winner snaps to opacity 1, losers fade to 0. No labels, no flash.
6. Locked words appear at the end of the response with a plain fade-in. No movement, no blur.
7. **Header** (top of page): plain monospace text. `session 47   token 12   47 voters` — just numbers and labels, lowercase. Current temperature shown as `t=1.0`. No clock.
8. **Footer**: plain text URL to vote. e.g. `vote at humanllm.exhibit/v`. No QR code styling — if a QR is needed, render it small, black-on-white, untreated.
9. White background, black text, system monospace only. No grain, no gradients, no accent colors.

### Phase 4 — Curator console
1. `/curator` behind password.
2. Four tabs:
   - **Queue**: list of queued prompts, reorder via drag, add new ones, edit, delete.
   - **Live**: current active session, current ballot, all submitted words with vote counts; buttons to hide a word, force-close the ballot, force-pick a winner, manually trigger tiebreaker, abandon the session. Also shows the pre-staged ballot if one exists.
   - **Tuning**: live-editable `BallotConfig` for the active session. Every field from the schema in *Ballot Closure Logic* is a control here. Changes apply to the *next* ballot, not the currently-open one (to avoid mid-ballot rule changes). "Reset to defaults" button. "Save as session default" / "Save as global default" actions.
   - **Archive**: completed sessions, full transcripts, exportable as text/JSON.
3. **Live metrics panel** (visible on Live and Tuning tabs): rolling stats updated every 10s.
   - Avg votes per ballot at close (this session / global)
   - Avg time per ballot (this session / global)
   - Soft timeout rate, hard timeout rate, tiebreaker rate
   - Words per hour (last 10 ballots)
   - Active voter count (SSE connections)
   - Each metric color-coded against the target ranges from *Tuning In Practice*: green (in range), amber (drifting), red (out of range) — so the curator sees at a glance whether to loosen or tighten thresholds.
4. **Presets**: one-click load of named configs:
   - "Patient (default)" — distribution-only, no timeouts, T=1
   - "Greedy" — T=0, deterministic, distribution-only
   - "Surreal" — T=1.5, distribution-only
   - "Paced (25/60 min)" — adds soft+hard timeouts for unattended exhibitions
   - "Fast cycle" — lower thresholds + soft timeout at 10 min (only for high-attendance demos)
   Curator can save custom presets.

### Phase 5 — Polish & install-readiness
1. Idle state for `/display` when no session is active: a quiet "the room is thinking" screen with archive excerpts cycling.
2. Sound design (optional, mutable): subtle hum that gets more harmonic as consensus builds. Use Tone.js. Probably skip for v1.
3. Analytics: count unique voters per session, average time-to-consensus, words-per-hour. Useful for the artist statement.
4. Export: print-ready PDF of completed sessions for catalog/artifact.
5. Network resilience: if SSE drops, reconnect with backoff and pull current state on reconnect.

---

## Visual & Interaction Specifications

### The emergence effect (`/display`)

Candidates are rendered as a **plain vertical list**, sorted by vote count (descending). Each candidate is a single line of monospace text. The only visual property tied to votes is **opacity**.

- **opacity:** `0.12 + share * 0.88` where `share = votes_for_word / total_votes_in_ballot`. Clamped to a 0.1 floor so even 1-vote words remain barely legible.
- **font:** system monospace, single weight. Same size as the locked response above.
- **color:** black. Always.
- **no blur, no scale, no rotation, no position randomization.**
- **sorting:** list re-orders as vote counts change. Use Framer Motion layout animation for the reorder (FLIP) so words slide smoothly into new positions.

Transitions: 0.8s ease for opacity changes. New words appear from opacity 0. On ballot close, all non-winning candidates fade to 0 over 1s; the winner stays at opacity 1.

The result is that the audience watches a list of words where the type weight is the probability distribution itself, sorting and brightening as the room votes. No theatricality. Just data.

### Sampling moment

When the ballot closes:
1. The list freezes its order.
2. For ~1s, all surviving candidates briefly equalize to their temperature-adjusted probabilities `p'` (opacity shifts to reflect `p'` instead of raw share). This visibly shows the temperature effect.
3. The sampled winner (which may not be the visual leader, especially at T>0) snaps to full opacity. All others fade to 0.
4. The winner then "joins" the locked response above — see below.

No "SAMPLING" label, no pulse, no flash. The animation alone communicates the moment.

### Locked-in response

Plain monospace text, black, flowing left-to-right with normal line wrapping. Each word wrapped in a span. When a ballot closes, the winning word appears at the end of the response with a simple 0.4s fade-in from opacity 0. No blur, no movement.

The full prompt and full response are always visible. No truncation, no summarization, no fading older text.

### State indicator

A single line of lowercase plain text below the candidate list:
- `gathering` — fewer than `confident_min_votes` votes
- `forming` — leader share < 40%
- `settling` — leader share 40-70%
- `converged` — leader share > 70%
- `contested` — >20 votes, leader share < 35%

No box, no border, no styling. Just the word in monospace, slightly dimmer than the candidates (opacity ~0.5). Updates live.

### Voter screen

- **Prompt** at top, plain monospace, black.
- **Locked response so far**, plain monospace, black, full text, auto-scrolling to keep the latest visible.
- **State indicator** in lowercase plain text.
- **Candidate list**: same as the display — a vertical list of words at opacity proportional to vote share. Each word is tap-to-vote. The user's current vote is marked with a leading `>` character (e.g. `> morning`). Tapping a different word changes the vote.
- **Free-text input** below the list: a single plain text input with placeholder `type a new word`. Submit on enter. No button.
- **No counts shown by default.** Numbers introduce competition; opacity is enough. (Optional toggle in a settings affordance for those who want to see vote counts.)
- **No countdown.**

### Curator screen

Same monospace world. Functional density is higher — lots of fields and tables — but no design treatments. Inputs are plain HTML inputs with no styling beyond a thin underline. Tables are plain text columns separated by spaces, monospace-aligned. Controls are text links (`force close`, `hide word`, `reset to defaults`) not buttons. Think: an admin interface for an academic project, not a SaaS dashboard.

---

## Open Decisions (flag for human before building)

1. **Vote weighting:** Should in-gallery voters (validated by being on local wifi or having scanned the QR within the past N minutes) count more than remote voters? Or remote-only? Or 1:1?
2. **Single vs parallel sessions:** v1 should be single active session. But the gallery wall feels dead during slow voting — consider rotating between 2-3 active sessions on the same wall.
3. **Profanity policy:** How aggressive? Words flagged but visible? Auto-hidden? Curator-reviewed queue? Recommend: server-side hard filter for slurs only, everything else allowed.
4. **Initial `BallotConfig` defaults:** The values in *Ballot Closure Logic* are educated guesses. First live session should be treated as calibration — curator watches metrics and tunes in real time.

---

## Non-Goals for v1

- Account system or user profiles
- Native mobile apps
- Multi-language support
- Voting on phrases longer than one word
- AI assistance of any kind (no autocomplete, no suggestions from a model — the whole point)
- Public API or embeds

---

## File Structure

```
human-llm/
├── apps/
│   └── server/
│       ├── src/
│       │   ├── index.ts                # Fastify app entry
│       │   ├── db/
│       │   │   ├── schema.ts           # Drizzle schema
│       │   │   └── migrations/
│       │   ├── routes/
│       │   │   ├── sessions.ts
│       │   │   ├── ballots.ts
│       │   │   ├── votes.ts
│       │   │   └── events.ts           # SSE
│       │   ├── workers/
│       │   │   └── ballot-lifecycle.ts
│       │   ├── lib/
│       │   │   ├── ballot-closure.ts     # closure conditions, tiebreaker, prestaging
│       │   │   ├── ballot-config.ts      # BallotConfig type + defaults + presets
│       │   │   ├── metrics.ts            # rolling stats for curator panel
│       │   │   ├── moderation.ts
│       │   │   └── voter-token.ts
│       │   └── public/                 # Vite build output served from here
│       └── package.json
├── apps/
│   └── web/
│       ├── src/
│       │   ├── routes/
│       │   │   ├── display.tsx
│       │   │   ├── vote.tsx
│       │   │   └── curator.tsx
│       │   ├── components/
│       │   │   ├── EmergenceCloud.tsx
│       │   │   ├── LockedResponse.tsx
│       │   │   ├── BallotInput.tsx
│       │   │   ├── CandidateChips.tsx
│       │   │   ├── curator/
│       │   │   │   ├── TuningPanel.tsx     # live BallotConfig editor
│       │   │   │   ├── MetricsPanel.tsx    # rolling stats with color coding
│       │   │   │   ├── PresetSelector.tsx
│       │   │   │   └── LiveBallotControls.tsx
│       │   │   └── PreStageBallot.tsx     # provisional next-ballot display
│       │   ├── hooks/
│       │   │   ├── useSession.ts
│       │   │   └── useSSE.ts
│       │   ├── lib/
│       │   │   └── api.ts
│       │   └── styles/
│       │       └── globals.css
│       └── package.json
├── fly.toml
├── Dockerfile
├── .github/workflows/deploy.yml
└── README.md
```

---

## Quick Start (for the implementer)

1. `pnpm install`
2. `docker compose up -d postgres` (or use Fly postgres locally via proxy)
3. `pnpm db:migrate`
4. `pnpm dev` — runs server on :3000, web dev server on :5173 with proxy
5. Visit `/curator`, set password, create a session, watch `/display`, vote at `/vote`
6. Deploy: `git push origin main` triggers GH Actions → Fly deploy

---

## Reference: Aesthetic Tokens

Use these as CSS variables in `globals.css`. The list is short on purpose.

```css
--bg: #ffffff;
--ink: #000000;
--ink-dim: rgba(0, 0, 0, 0.5);   /* state indicator, metadata */

--font-mono: ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace;

--text-size: 18px;               /* base — slightly larger on /display */
--line-height: 1.5;
```

That's the entire design system. No gradients, no grain, no accent colors, no second typeface. Background is `#ffffff`, text is `#000000`. Variations in emphasis are achieved through opacity, not color or weight. All three surfaces (display, voter, curator) share this. The reference mockup is `human-llm-mockup-stark.html`.
