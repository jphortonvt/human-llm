# human llm

A gallery installation where a crowd of humans performs next-word prediction.
The "model" is the room: each token of the response is a separate ballot, and the
winner is **sampled** from the vote distribution (temperature sampling), exactly
like a real LLM. See [plan.md](plan.md) for the full concept and spec.

## Stack

- **Server** — Fastify + TypeScript. REST for mutations, SSE for live updates.
  Drizzle ORM over Postgres. Embedded **PGlite** for local dev (no Docker), and
  **node-postgres** in production — set `DATABASE_URL` to switch.
- **Web** — React + Vite + TypeScript. Framer Motion for the emergence/sampling
  animation. One monospace typeface, white/black, emphasis via opacity only.

Three surfaces, one backend: `/display` (gallery wall), `/vote` (phone), `/curator`
(password-gated console).

## Quick start

```bash
npm install
npm run dev          # api on :3000, web on :5173 (proxies /api -> :3000)
```

Then:

1. open http://localhost:5173/curator (default password `curator`, override with
   `CURATOR_PASSWORD`), add a prompt — it auto-activates.
2. open http://localhost:5173/display for the wall.
3. open http://localhost:5173/vote on a phone (or another tab) and vote.

The embedded database persists to `server/.pgdata/`. Delete it to reset.

## How a ballot resolves

A lifecycle worker evaluates every open ballot ~every 2s against **distribution-driven**
closure conditions (landslide / confident close), with optional timeout safety nets.
On close, the winner is sampled via the temperature transform
`p_i' = p_i^(1/T) / Σ p_j^(1/T)`. At `T=1` votes *are* probabilities, so the vote
leader does not always win — that "upset" is the conceptual core of the piece.
Pre-staging opens a provisional next ballot once a leader crosses 50%. All of this
is tunable per-session from the curator Tuning tab. See `server/src/lib/ballot-closure.ts`.

## Environment

| var | default | meaning |
|---|---|---|
| `DATABASE_URL` | _(unset → PGlite)_ | Postgres connection string for production |
| `PORT` | `3000` | api port |
| `CURATOR_PASSWORD` | `curator` | shared password for `/curator`. **Required** in production (`NODE_ENV=production`) — the server refuses to boot with the default, since the console is internet-reachable. Auth is constant-time and per-IP rate-limited. |

## Production build

```bash
npm run build        # builds web into server/public, compiles server
npm start            # single Fastify process serves the SPA + api
```

## Status

- Phase 1 — backend skeleton ✅ (schema, closure logic, REST, SSE, worker, pre-staging, session lifecycle)
- Phase 2 — voter interface ✅
- Phase 3 — gallery display ✅ (opacity emergence, state indicator, sampling moment)
- Phase 4 — curator console ✅ (queue, live, tuning, archive, metrics, presets)
- Phase 5 — polish (idle screen, sound, PDF export, deploy config) — not yet started
