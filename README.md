# SciBowl Arena

A self-hosted Science Bowl practice platform: upload packets (PDF/DOCX/JSON), practice solo or in endless marathon mode, and compete in realtime multiplayer with buzzer rules.

## Quick start

```bash
npm install
cp .env.local.example .env.local   # then fill in the placeholders — see Setup
npm run dev                        # Next.js dev server + WebSocket realtime on :3000
```

Open http://localhost:3000 and sign in.

## Setup

All configuration lives in `.env.local` (git-ignored). [`.env.local.example`](.env.local.example) is the template — copy it and replace the placeholders. Every value is read once at startup, so restart the server after editing.

### 1. Clerk (authentication) — required

Clerk owns identity: sign-in, sign-up, email verification, password resets, and the session JWTs the API and WebSocket verify. The app stores no passwords.

1. Create a free application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. Under **User & Authentication → Email, Phone, Username**, enable **Email address** (and optionally Google or another social provider under **Social Connections**). Everything is rendered by Clerk's hosted `<SignIn/>`/`<SignUp/>` components, so no extra UI work is needed.
3. From **API Keys**, copy both keys into `.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

4. For a deployed instance, add your production domain in Clerk (**Domains**) and use that instance's live keys (`pk_live_…` / `sk_live_…`).

Without both keys the app shows a setup notice, `proxy.js` passes requests through unauthenticated, and every API route returns 503 (`server/auth.js`). Users are keyed by **email address** throughout — stats and leaderboard rows follow the email on the Clerk account, so a user who changes their primary email starts a fresh stats row.

### 2. Supabase (rounds, stats, help content) — recommended

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. Open **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql). It creates `app_users`, `rounds`, `user_stats`, `leaderboard_entries`, and `help_content` with their indexes, and enables RLS with no policies so the tables are unreachable with the public anon key. **Every statement is idempotent, so re-run this file after pulling schema changes** — it also carries the migrations that add columns to existing tables.
3. From **Project Settings → API**, add to `.env.local`:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

4. Seed the question library and the Help & Guide content:

```bash
npm run seed        # = seed:rounds + seed:help
```

Both are idempotent — re-run them any time; an unchanged source produces zero writes.

The service-role key is used only on the server — it bypasses RLS, so never prefix it with `NEXT_PUBLIC_` or ship it to the browser. Until Supabase is configured, rounds and stats fall back to the local JSON store (`server/data/db.json`) so the app still runs, but nothing is shared between machines or deploys.

**Storage.** Uploaded packet files (PDF/DOCX) go to a public Supabase Storage bucket named `uploads`, which the server creates on first upload — no dashboard setup needed.

### 3. No other services required

There are no other third-party integrations: PDF and DOCX parsing run in the browser (`pdfjs-dist`, `mammoth`), multiplayer realtime is the app's own WebSocket server on `/ws`, and no LLM API is called — the "LLM Import" flow on the Help page gives you a prompt to paste into any chat assistant, and you paste the JSON back.

## Importing rounds

`scripts/import-rounds.js` bulk-loads question sets into whichever datastore is configured — Supabase when the keys are set, the local JSON store otherwise.

```bash
npm run seed:rounds                          # import the bundled export.csv
npm run seed:rounds -- --dry-run             # report the plan, write nothing
npm run import:rounds -- some-packets.json   # any other source
```

Accepted inputs: a Base44 Round-entity export (CSV or JSON), a question-per-row CSV, SciBowl Arena packet JSON, a `server/data/db.json` snapshot (use this to move local rounds into Supabase), or `--base44 <appId> <apiKey>` to pull straight from the Base44 API.

**Deduplication is by content, not by title.** Rounds are identified by a hash of their questions, so re-running imports nothing new, while two genuinely different packets that happen to share a title (real exports contain these — `export.csv` has four) both import, the second with a disambiguating `(48q)` suffix. `--force` imports everything regardless. Start with `--dry-run`: it prints the destination and the exact plan, which is the quickest check that your Supabase keys are being picked up.

## Production

```bash
npm run build      # next build
npm start          # serves the built app + realtime from :3000
```

## Architecture

- **Framework** — Next.js (App Router) with a custom server (`server.js`) that adds the two things route handlers can't do: the WebSocket realtime channel (`/ws`) and static serving of uploaded packets (`/uploads/*`).
- **Frontend** — React 19 + Tailwind/shadcn. Pages live in `app/`, each wrapping a client-only view from `src/views/`. Auth UI is Clerk's `<SignIn/>`/`<SignUp/>`; `src/lib/AuthContext.jsx` adapts Clerk to the app's `useAuth()` interface and feeds session tokens to the API client (`src/api/base44Client.js`).
- **Backend** — Next.js route handlers in `app/api/` backed by `server/`: Clerk JWT verification (`server/auth.js`, plus `@clerk/backend` token verification for the WebSocket), entity CRUD, file uploads, and realtime push of game-session updates for multiplayer buzzing (`server/realtime.js`). Requests are gated by Clerk's `proxy.js` at the edge of the app.
- **Storage** — split by kind (`server/store.js`): any entity listed in `TABLES` (`server/supabase.js`) goes to **Supabase** Postgres when the keys are set — `Round`, `UserStats`, `LeaderboardEntry`, `HelpContent` — and falls back to the local JSON file when they aren't. `GameSession` is always local (`server/data/db.json`) so buzz claims stay atomic in-process. Uploaded packets go to the Supabase `uploads` bucket, or `server/uploads/` locally.

## Roles and packet visibility

Clerk authenticates; the app's own `app_users` table authorizes. A row is created the first time someone makes an authenticated request, so signing in is all it takes to be registered.

| Role | Can create | Can edit / delete | Sees in the library |
|---|---|---|---|
| **admin** | public and private packets | any packet | everything |
| **player** | private packets only | their own private packets | public packets + their own |

**A private packet is not an unplayable one.** It stays out of everyone else's library, but when its owner hosts a multiplayer room and picks it for **round practice**, every player in that room gets the questions, served through `/api/sessions/[id]/rounds` (members only). Visibility governs browsing and editing, not who can be dealt the questions.

**Marathon is public-only**, in both Solo Play and Multiplayer. This is a determinism requirement rather than a privacy one: a marathon materializes question *k* from `(seed, k)` against the pool, and each client builds its own pool locally — so if private packets could enter, two players in the same room would derive different questions for the same index. `buildMarathonPools` enforces it centrally (`src/utils/marathon.js`) rather than at each call site, and a multiplayer room stores its resolved packet list explicitly instead of an implicit "all". Private packets remain fully playable in round practice.

Getting the first admin:

- The **first user to sign in** on a fresh deployment becomes admin — otherwise nobody could ever publish, and nobody could promote anyone.
- Or set `ADMIN_EMAILS="you@example.com,other@example.com"` in `.env.local`; anyone listed is an admin at sign-in regardless of the table. This is also the recovery path if the roles get into a bad state.
- An existing admin can promote others by PATCHing `role` on their `AppUser` record.

Enforcement lives in `server/rounds.js` and is applied in the entity routes; the UI only hides actions that would be rejected anyway.

## Multiplayer timing

Two players' machines disagree about the time, and their packets take different paths to the server. Both are handled explicitly, because either one silently corrupts a buzzer game.

- **One clock.** Every shared instant — when reading started, when someone buzzed — is on the *server's* clock. Each client measures its offset against `/api/time` with an NTP-style handshake (`src/lib/clock.js`, best-of-5 by round trip) and converts. Question reading is derived from that, so all clients sit on the same word.
- **Buzz arbitration.** The client stamps its own buzz instant; the server holds a 150 ms window (`server/buzz.js`), collects every claim inside it, and awards the buzz to the *earliest stamped* one — so the player who actually hit the buzzer first wins, not the one with the shortest network path. The margin over the runner-up is reported back and shown to both players. Tune the window with `ARBITRATION_WINDOW_MS`: wider absorbs more latency spread, at the cost of that much delay before the lock resolves.
- **The lock does not wait for arbitration.** The first claim to reach the server broadcasts a *provisional* lock immediately, so every other screen locks one network hop after the buzz instead of after the window plus a round trip. Arbitration still decides who actually gets it, and the settled frame is pushed from the window itself rather than from the winner's response. A press made after the provisional frame arrives is necessarily later than the pending buzz, so nobody is shut out unfairly; a claim already in flight is unaffected.
- **Nothing can strand a room.** A buzz held past the answer window (frozen tab, closed laptop) is released by any client's report and recorded as an unanswered attempt (`applyStaleBuzzRelease`). A dead question is advanceable by *every* player unconditionally; the host can always force the match forward; and if the room is waiting on someone who has left, anyone may advance. The host role is handed over when the host leaves.
- **The answer is never shown early.** A wrong answer leaves a tossup live for the other teams, so no client is given the answer text until the question is won or dead — at which point it appears under the result banner.
- **Tested.** `npm test` runs `server/*.test.js` (node:test) over the match engine and arbitration: wrong-answer limits, reveal gating, buzz ownership, and every softlock path above. The suite chdirs to a temp directory so it never touches a real `server/data/db.json`.
- **Server-authoritative state.** Buzzing, scoring, question advancement, and leaving are server transitions (`server/match.js`), applied inside one synchronous critical section. Clients no longer compute scores and write back whole sessions, which used to let two simultaneous writers clobber each other's arrays.
- **Room-scoped patches.** Socket frames carry only the fields that changed and go only to sockets subscribed to that game, instead of broadcasting whole sessions to every signed-in user.
- **Reconnects resync.** A reopened socket re-subscribes and forces a state refetch rather than waiting for the slow poll.

## Notes

- Multiplayer buzzes are arbitrated on the server, so simultaneous buzzes always have exactly one winner — decided by buzz time, not arrival order.
- **Marathon is not a separate page.** Solo Play and Multiplayer each start with a choice of *round practice* (one packet, start to finish) or *marathon* (endless, sampled from a pool you configure). Multiplayer marathon rooms store only `{ seed, round_ids, subject_freq }` — every client derives the identical infinite question sequence from the seed (`src/utils/marathon.js`).
- After a multiplayer round ends the host can play another round with the same players (back to selection, scores reset) or close the room; everyone else follows automatically over the socket.
- Help & Guide content is stored one row per part — a `header` row, one row per section, and a `cta` row, each with `{ kind, slug, position, content }`. `src/views/Help.jsx` reassembles them via `assembleHelpContent`, so a section can be edited on its own without rewriting the whole page. `npm run seed:help` matches rows by `slug` and updates them in place; `-- --dry-run` reports without writing.
