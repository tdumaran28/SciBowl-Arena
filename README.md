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

This is the deployment target the app is built for: **one long-lived Node process**. Two things depend on that and cannot be worked around by configuration.

- **The realtime channel is our own WebSocket server**, attached to the HTTP server in `server.js` on `/ws`. Route handlers reach it through `globalThis.__scibowlBroadcast`, which only exists inside that process.
- **`GameSession` is held in-process** (`server/store.js` keeps it in the local JSON store deliberately, so a buzz claim is a synchronous read-modify-write), and buzz arbitration is a 150 ms window held in an in-memory `Map` (`server/buzz.js`). Both assume every request for a room reaches the same process.

Anything that gives you a persistent process works with no code changes — a VPS behind nginx, Render, Fly.io, or a container host. Set the same environment variables, run `npm run build`, then `npm start`, and point the proxy at `:3000` with WebSocket upgrades passed through (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

**Never run more than one instance.** A room lives in one process's memory, and a buzz is arbitrated in a 150 ms in-memory window. Behind a load balancer with two instances, half the requests for a room would land on a process that has never heard of it — rooms appearing and vanishing, buzzes lost, scores diverging, and no error anywhere. Scale the instance up, never out.

### Deploying on Render (free)

Render's free Web Service is one long-lived Node process, which is the shape this app needs — multiplayer works, unlike on Vercel. Everything below is on a free tier.

| Service | What it holds | Free-tier limits that matter |
|---|---|---|
| **Render** Web Service | the app, and every live game room | 512 MB RAM, 0.1 CPU; **sleeps after 15 min idle**; a monthly instance-hour allowance (currently 750) |
| **Clerk** | identity — sign-in, sessions | production instances need DNS on a domain you own (see below) |
| **Supabase** | packets, stats, leaderboard, uploads | 500 MB Postgres, 1 GB storage; **project pauses after ~1 week idle** |
| an uptime pinger (UptimeRobot, cron-job.org) | nothing — just keeps Render awake | optional, see the instance-hour arithmetic below |

**Before the first deploy.** `server/data/` is git-ignored, but if a `db.json` was committed before that, evict it — it is read at startup, so a committed copy ships your local rooms (and the player emails in them) to production:

```bash
git rm --cached server/data/db.json
```

**Deploy.**

1. Do the [Setup](#setup) steps for Clerk and Supabase first, including running `supabase/schema.sql` and `npm run seed`. Seeding runs **from your machine** against the production Supabase project — the free Render plan has no shell, and the seed scripts read `.env.local` through `@next/env`.
2. Render → **New → Web Service** → connect the GitHub repo.
   - Runtime **Node** · Build Command `npm ci && npm run build` · Start Command `npm start`
   - Instance Type **Free**
   - **Health Check Path `/api/time`** — it is deliberately unauthenticated and does nothing but read the clock, so it is the right probe.
3. Add the environment variables (**Environment** tab) **before the first deploy**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`. **Do not set `PORT`** — Render injects it and `server.js` reads it. Node version comes from `.node-version`/`engines`, so Render will not drift onto an older runtime than Next needs.

   The ordering matters more than it looks. Most of the app's pages are prerendered at build time (`next build` reports them as `○ (Static)`), and the root layout decides whether Clerk is configured by reading `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — so a build that ran without it bakes the "Authentication not configured" notice into those pages, and adding the variable afterwards changes nothing until you rebuild.
4. Deploy, then add the `*.onrender.com` URL to Clerk so sign-in is allowed from it. Auto-deploy on push to the tracked branch is on by default.

**Set `ADMIN_EMAILS` before you share the URL.** On an empty database the *first person to sign in becomes admin* — that bootstrap exists so a new deployment isn't adminless, but on a public URL that could be a stranger, and admins can publish public packets to everyone's library.

#### What the free tier will do to you

- **Sleeping no longer ends a match, but it does interrupt one.** The instance stops after 15 minutes without traffic, and rooms live in its memory. Two things now stand between that and a lost game, and they are worth understanding separately — see [Surviving a restart](#surviving-a-restart). In short: rooms are **mirrored to Postgres and restored on boot**, so a spin-down or a redeploy costs a cold start rather than the game; and setting `KEEP_WARM_URL` makes the server ping itself so an idle spin-down doesn't happen mid-session at all. Mind the arithmetic before turning the pinger on around the clock: a 31-day month is 744 hours against an allowance of 750, so **one** always-on free service just fits and a second one will not — `KEEP_WARM_MODE=active` pings only while players are connected and costs a fraction of that. (Render's own health checks do not count as the traffic that keeps a free service awake, which is why the ping goes out to the public URL and back in.)
- **Cold starts are slow.** After sleeping, the first visitor waits for the container to start *and* for `app.prepare()` to load Next's module graph. Keeping it awake is the only fix.
- **There is no disk, so Supabase is required — not "recommended".** Without those keys every packet, stat and leaderboard row goes to `server/data/db.json` on an ephemeral filesystem and is erased by each deploy and each sleep. With them, only game sessions are in-process (which is by design) and uploads go to Supabase Storage.
- **512 MB may not be enough to build.** If a deploy dies with an out-of-memory or `Killed` message, build on a paid instance once and downgrade after, or build locally and deploy a prebuilt image.
- **Clerk will be a development instance.** Production instances are configured with CNAME records on a domain you control, and you do not control `onrender.com` — so expect to run `pk_test_`/`sk_test_` keys there, and check Clerk's current development-instance limits before inviting a crowd. A ~$10/year domain gets you a real production instance, and lets you keep the URL if you ever move hosts.
- **Supabase pauses when idle.** After roughly a week of no queries the project is paused and the library and stats stop working until you resume it from the dashboard. Expect this between seasons.

#### Surviving a restart

A room is played out of the server's own memory — a buzz claim has to be a synchronous read-modify-write, and nothing about that survives being moved behind a network call. That is why `GameSession` never went to Supabase, and it is also why every spin-down and every redeploy used to end every game in progress.

It is now handled in two layers, which do different jobs:

| | What it does | What it costs |
|---|---|---|
| **Session mirror** (always on with Supabase configured) | Every write to a room is mirrored to the `game_sessions` table write-behind, and read back **once, at boot**. A restart costs a cold start; the room, the scores and the question log come back. | One small upsert per game action, off the request path. Needs `supabase/schema.sql` re-run for the new table. |
| **Self-ping** (`KEEP_WARM_URL`) | Keeps the instance from spinning down in the first place, so there is no cold start to sit through mid-session. | Instance-hours — see the arithmetic above, and `KEEP_WARM_MODE=active`. |

The mirror is a copy and never a source of truth: nothing reads it while the server is up, so buzz arbitration is exactly as atomic as it was. **This is safe only because there is one process** — two instances would each restore the same rooms from it and then diverge silently. The "never run more than one instance" rule above is now load-bearing in one more place.

What is *not* restored: the WebSocket connections. Clients reconnect on their own and force a state refetch (`resync`), so players see the room come back rather than having to rejoin — but anyone who buzzed during the outage lost that buzz, and a question whose answer clock ran out while the server was down is released by the stale-buzz watchdog when it returns.

Without Supabase configured, or against a database that predates the `game_sessions` table, everything degrades to the old behaviour: matches run normally and simply do not survive a restart. The server says so once in the logs (`[sessions] The 'game_sessions' table is missing…`).

#### Deploying, and living with it afterwards

- **Each deploy is still a restart**, and a restart still interrupts matches in progress — players wait through a cold start and their sockets reconnect. With the mirror in place the games resume rather than ending, but it is not a rolling deploy. Push between practice sessions, not during them.
- **Routine maintenance is close to nothing.** The app holds no durable state of its own; Supabase does. After pulling schema changes, re-run `supabase/schema.sql` — every statement is idempotent. Add packets through the app, or `npm run seed:rounds -- packets.json` locally against the production project.
- **What to watch in the Render logs.** Three messages each mean a specific misconfiguration: `[store] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set` (the keys did not reach the service, so everything is going to a disk that will be wiped); `[db] cannot write …` (the JSON fallback is in use *and* unwritable — harmless in itself, but it means the store is memory-only); and `[supabase] The rounds table is missing the name/is_public/owner_email columns` (run `schema.sql`).
- **Check monthly:** the Supabase project is not paused, Render instance-hours are under the cap, and Clerk's active-user count is within its tier.
- **Rotating a key** means editing it in Render and **redeploying** — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is compiled into the browser bundle at build time, so an env edit alone does nothing.
- **Export anything you would hate to lose.** Free-tier backup retention is short. A season of stats is a few hundred rows; dump it from Supabase periodically.
- **Upgrading** to a paid Render instance removes the sleep, the cold starts and the memory pressure, and adds a persistent disk. Whatever you do, keep the instance count at **one** — see the warning above.

### Deploying on Vercel

Vercel builds the Next app and serves it from serverless functions. **`server.js` is never executed** — there is no custom server, no long-lived process, and the deployment filesystem is read-only. So:

| | On Vercel |
|---|---|
| Pages, auth, library, Help, PDF/DOCX parsing | Work |
| Solo Play and solo Marathon | Work — all state is client-side, stats go to Supabase |
| Uploads | Work **only with Supabase configured** (they go to Storage; the local `server/uploads` path needs a writable disk) |
| Multiplayer | **Does not work.** `/ws` does not exist, so there is no realtime push; and each function invocation gets its own empty copy of the `GameSession` store, so a room created by one request is not there for the next |

Multiplayer failing is not a degradation to fix with a longer poll interval — the sessions are not shared at all. **If you want multiplayer, use a host with a persistent process** (above). Use Vercel when solo practice and the packet library are what you need.

Setup, once Clerk and Supabase exist (see [Setup](#setup) — do the Supabase schema and seeding from your machine, they write straight to the project):

1. Push the repo to GitHub and import it at [vercel.com/new](https://vercel.com/new). The framework is detected as Next.js; the default build command (`next build`) and output settings are correct. Leave the start command alone — Vercel does not use one.
2. In **Project Settings → Environment Variables**, add for every environment you deploy:

   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   pk_live_…   (pk_test_… for previews)
   CLERK_SECRET_KEY                    sk_live_…
   SUPABASE_URL                        https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY           eyJ…
   ADMIN_EMAILS                        you@example.com      (optional)
   ```

   Do **not** set `PORT`, and do not add `NEXT_PUBLIC_` to the Supabase service-role key — it bypasses row-level security and must stay server-only.
3. Supabase is not optional here. Without it every entity falls back to the local JSON store, which on Vercel is an empty in-memory copy per function instance: packets would vanish between requests.
4. In the Clerk dashboard, create a **production instance**, add your Vercel domain under **Domains**, and use that instance's live keys. Preview deployments get their own URLs, so keep the test instance's keys on the Preview environment.
5. Deploy. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is inlined into the client bundle at build time, so **changing it requires a redeploy**, not just an env-var edit.

Making multiplayer work on Vercel is a port, not a setting: `GameSession` would have to move into Postgres (with the buzz claim as an atomic statement or an advisory lock rather than a synchronous critical section), and `server/realtime.js` would have to publish to Supabase Realtime instead of the `/ws` server.

## Architecture

- **Framework** — Next.js (App Router) with a custom server (`server.js`) that adds the two things route handlers can't do: the WebSocket realtime channel (`/ws`) and static serving of uploaded packets (`/uploads/*`).
- **Frontend** — React 19 + Tailwind/shadcn. Pages live in `app/`, each wrapping a client-only view from `src/views/`. Auth UI is Clerk's `<SignIn/>`/`<SignUp/>`; `src/lib/AuthContext.jsx` adapts Clerk to the app's `useAuth()` interface and feeds session tokens to the API client (`src/api/base44Client.js`).
- **Backend** — Next.js route handlers in `app/api/` backed by `server/`: Clerk JWT verification (`server/auth.js`, plus `@clerk/backend` token verification for the WebSocket), entity CRUD, file uploads, and realtime push of game-session updates for multiplayer buzzing (`server/realtime.js`). Requests are gated by Clerk's `proxy.js` at the edge of the app.
- **Storage** — split by kind (`server/store.js`): any entity listed in `TABLES` (`server/supabase.js`) goes to **Supabase** Postgres when the keys are set — `Round`, `UserStats`, `LeaderboardEntry`, `HelpContent` — and falls back to the local JSON file when they aren't. `GameSession` is always served from the local store (`server/data/db.json`) so buzz claims stay atomic in-process, and is *mirrored* to Postgres write-behind by `server/sessionStore.js` so rooms survive a restart — a copy, read once at boot, never on the request path. Uploaded packets go to the Supabase `uploads` bucket, or `server/uploads/` locally.

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
- **Advancing belongs to the players, not to the host.** Who may press *Next* is a rule about the game, not a permission:
  - a **won tossup** is advanced by the winning team alone — the bonus that follows is theirs, so the pace of getting to it is theirs;
  - a **finished bonus** (right, wrong or dead) is advanced by anybody, since it is over for the whole room;
  - a **live question** is advanced by nobody. There is no skip, and the host has no override — a question is ended by being answered, by its clock, or by everyone missing it.

  The host cannot end a round early either. What the host *can* do is **pause** (`P`), which freezes the reading and shuts the buzzer for everyone at once; it is the one match control that is host-only, precisely because it stops play for everybody.
- **A marathon is ended by agreement.** Round practice ends when its packet does; a marathon draws question *k* from `(seed, k)` forever, so it needs some way to stop — and a host button is exactly the unilateral power above. Instead **any** player may ask. Alone in the room there is nobody to ask and it simply ends; otherwise everyone else has to accept, one decline drops it, and an unanswered request lapses after a minute. Unanimity rather than a majority because the cost of a "no" is only that the game carries on, which is what everyone joined for. The request is released rather than stranded when the player it was waiting on leaves, and it goes with the player who made it (`resolveEndVoteAfterLeave`). Early ending is refused outright for round practice, which would otherwise be the host's early end under another name.
- **Nothing can strand a room.** With the host override gone, this is carried entirely by rules that cannot leave every player stuck: a buzz held past the answer window (frozen tab, closed laptop) is released by any client's report and recorded as an unanswered attempt (`applyStaleBuzzRelease`); a dead question is advanceable by *every* player unconditionally; a question **everyone still in the room has already missed is dead**, counted over the players actually present rather than over the `teams` array, which keeps a row after its last member leaves; if the room is waiting on someone who has gone, anyone may advance; and an untimed room — which has no clock to kill a question nobody buzzes — lets any player move on from one nobody took. The host role is handed over when the host leaves. `server/match.test.js` walks 300 random sequences of every event a match can produce and asserts after each one that somebody can still act.
- **Teams are not optional.** Every player joins or creates a team before the match can start (enforced in the room UI *and* in the `start` transition). A player with no team has no side to score for, no lockout to share and no bonus to be dealt, so the room lists its roster once — under the teams — rather than keeping a separate players list that could disagree with it.
- **The answer is never shown early.** A wrong answer leaves a tossup live for the other teams, so no client is given the answer text until the question is won or dead — at which point it appears under the result banner.
- **A wrong answer is not the end of the question**, and everything that touches the buzzer has to say so. The result fields are populated while a tossup is still live for the other teams, so "is this over?" is `questionClosed()` — dead, answered correctly, or a bonus that has been answered — and never `!!result`. Reading it as `!!result` is a specific bug with a specific symptom: the next team pressed the buzzer, the arbitration window refused to award it, and their answer box appeared and vanished. The rule is stated once on each side (`server/match.js`, `src/utils/matchRules.js`) and both are driven by the same tests.
- **Reading stops where the buzz landed.** The word-by-word position is derived from `now - reading_started_at` so every client sits on the same word, which means a freeze cannot simply stop the timer: the drift correction would fast-forward past it a couple of seconds later and read the rest of the question out from under the player who had buzzed. Instead the *start* moves — when a question reopens after a wrong answer, or resumes after a host pause, `reading_started_at` is pushed forward by exactly the frozen interval, so the one formula stays right and the other teams pick up on the word it stopped at.
- **A question nobody scored on is still in the question log.** One that timed out, or that the room stepped over, is recorded with a grey zero rather than left out — a log that omits it makes the numbering jump and leaves nothing to click to read the question back. Logged once however many clients report the timeout, and never on top of the wrong answers that already killed it.
- **Tested.** `npm test` runs `server/*.test.js` (node:test) over the match engine and arbitration: wrong-answer limits, reveal gating, buzz ownership, and every softlock path above. The suite chdirs to a temp directory so it never touches a real `server/data/db.json`.
- **Server-authoritative state.** Buzzing, scoring, question advancement, and leaving are server transitions (`server/match.js`), applied inside one synchronous critical section. Clients no longer compute scores and write back whole sessions, which used to let two simultaneous writers clobber each other's arrays.
- **Server-authoritative identity.** *Who* acted is resolved from the Clerk session against the room's stored roster (`requireSessionPlayer` in `server/sessions.js`), never from the request body — so a buzz, an answer, a chat message or a leave is always attributed to the caller. Rooms are readable by id to anyone signed in (that is how joining by code works), so a body-supplied player id was enough to score a question onto someone else's row, chat as them, or drop them out of a live match. Every match route also requires the caller to be *in* the room: the transitions are deliberately open to every player, which has to mean every player of that game.
- **Anyone on a team may buzz.** A tossup is individual, so it is not gated on `captain_id` — that is a display marker, assigned once to whoever named the team and never reassigned. Gating the buzzer on it meant one nominated player per team could ever buzz, and a team whose captain shut their laptop was locked out for the rest of the match.
- **A bonus is read to the team it belongs to.** Win the tossup and the bonus goes to your whole team and to nobody else — so it is *read out* to them, word by word, exactly like a tossup, from the same server-stamped clock. Every other team sees the same question as static text with no answer box: they are not being read it, because they cannot answer it. There is no buzz for it: every player on the owning team gets an answer box open for the entire bonus window, and the first one to submit is the team's answer — which is how a team plays a bonus, conferring and then one of them saying it. Arbitrating a buzz instead would let the first teammate to hit the button lock the other three out of their own bonus. First-submission-wins is enforced in `applyAnswer` (one synchronous critical section, so the second submission is rejected rather than scored a second time), as is the rule that another team cannot answer it at all. **A bonus nobody earned is never read** — the advance path steps over it, in marathon exactly as in round practice.
- **A bonus ends when its team can no longer answer it.** The window running out marks it dead; so does the last player on the owning team leaving — the bonus survives the player who *won* it leaving, since it was the team's, but not the whole team going. Either way it reads as dead to everyone, the answer is revealed, and **any player from any team may press next**. Only the owning team's clients run a bonus clock, so a separate watchdog closes the abandoned case on the server rather than leaving the question open forever.
- **Room-scoped patches.** Socket frames carry only the fields that changed and go only to sockets subscribed to that game, instead of broadcasting whole sessions to every signed-in user.
- **Reconnects resync.** A reopened socket re-subscribes and forces a state refetch rather than waiting for the slow poll.

## Notes

- Multiplayer buzzes are arbitrated on the server, so simultaneous buzzes always have exactly one winner — decided by buzz time, not arrival order.
- **Marathon is not a separate page.** Solo Play and Multiplayer each start with a choice of *round practice* (one packet, start to finish) or *marathon* (endless, sampled from a pool you configure). Multiplayer marathon rooms store only `{ seed, round_ids, subject_freq }` — every client derives the identical infinite question sequence from the seed (`src/utils/marathon.js`).
- **A marathon draw is sampled, not paired — but a bonus is still a bonus.** Marathon has no tossup/bonus pairs; it draws question *k* from `(seed, k)`. A drawn BONUS is nonetheless awarded to the team that won the draw before it, and stepped over when nobody won that draw, so the bonus rules above hold in marathon too. (Turn on **boss-ups** to play bonuses as open tossups instead, and the question of ownership does not arise.)
- After a multiplayer round ends the host can play another round with the same players (back to selection, scores reset), or leave; everyone else follows automatically over the socket.
- Help & Guide content is stored one row per part — a `header` row, one row per section, and a `cta` row, each with `{ kind, slug, position, content }`. `src/views/Help.jsx` reassembles them via `assembleHelpContent`, so a section can be edited on its own without rewriting the whole page. `npm run seed:help` matches rows by `slug` and updates them in place; `-- --dry-run` reports without writing.
