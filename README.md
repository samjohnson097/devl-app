# DEVL

**DEVL** (Dig Easy Volleyball League) is a web app for running a recreational volleyball league: seasons, player intake, Monday availability, game-night scheduling, scores, standings, playoffs, and end-of-season champions photos.

Organizers manage seasons after signing in with Supabase Auth. Players join and update availability through a public intake link—no account required.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Create React App, React Router |
| Backend / DB | [Supabase](https://supabase.com) (Postgres, Auth, RLS, Storage, RPCs) |
| Hosting | [Vercel](https://vercel.com) (SPA rewrites in `vercel.json`) |
| Analytics | Vercel Analytics + Speed Insights |

There is no custom Node server. The browser talks to Supabase via the anon key; privileged writes go through **security definer** Postgres RPCs that require an authenticated organizer.

## Features

### Public
- Season picker on the home page (standings, announcements, Monday timeline, match recap)
- Optional win-% participation penalty on standings
- Player **intake form** (`/league/:slug/join`): name, email, pronouns, Monday availability, league agreements
- Returning players can **update availability** with the same email (Load my schedule → edit → submit) without creating a duplicate roster entry
- Shareable game-night schedule sheet (admin-generated link)
- Champions photos (gold / silver) when uploaded for a season

### Organizer (signed in)
- Create seasons with intake Mondays
- Roster: add walk-ons, edit names, soft-remove players (past games kept)
- Game nights: attendance, auto schedule generation, manual match entry, scores
- Cancel a week and append a make-up Monday (other dates + availability preserved)
- Truncate trailing intake weeks
- Playoffs: pool play, gold/silver brackets
- Announcements, feedback inbox, hide season from logged-out visitors
- Upload gold/silver winners photos (Storage, up to 20 MB)

## Local development

### Prerequisites
- Node.js 18+ (recommended)
- A Supabase project
- npm

### 1. Clone and install

```bash
git clone https://github.com/samjohnson097/devl-app.git
cd devl-app
npm install
```

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in from **Supabase → Project Settings → API**:

```env
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Database

In the Supabase **SQL Editor**, run:

1. Full baseline: [`supabase/schema.sql`](supabase/schema.sql)  
   (tables, RLS, RPCs, Storage bucket `season-winners`)

2. If the project already exists and you only need incremental fixes, apply any missing files under [`supabase/patches/`](supabase/patches/) in order:

| Patch | Purpose |
| --- | --- |
| `001_row_security_off_for_definer.sql` | Definer RPCs bypass RLS safely |
| `002_player_soft_remove.sql` | Soft-remove players (`removed_at`) |
| `003_intake_update_by_email.sql` | Intake upsert + load-by-email |
| `004_fix_cancel_week.sql` | Cancel one week, keep other dates/availability |
| `005_season_winners_photos.sql` | Champions photos columns, RPC, Storage |
| `006_winners_photo_size_20mb.sql` | Raise winners photo limit to 20 MB |

For a **brand-new** project, `schema.sql` alone is enough if it is current; patches are for existing deployments that already ran an older schema.

### 4. Auth

In Supabase Auth:

- Create an organizer user (email/password is fine for a shared account)
- Set **Site URL** and redirect URLs to your local origin (`http://localhost:3000`) and production domain

### 5. Run the app

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Dev server on port **3000** |
| `npm run build` | Production build → `build/` |
| `npm test` | Jest / React Testing Library (e.g. schedule 3v3 balancing) |

## Routes

| Path | Who | Purpose |
| --- | --- | --- |
| `/` | Public | Home: seasons, standings, recap, create season (when signed in) |
| `/admin/login` | Organizers | Sign in |
| `/league/:slug/join` | Players | Intake / update availability |
| `/league/:slug/admin` | Organizers | Season admin (roster, nights, playoffs, settings) |
| `/league/:slug/admin/night/:nightId` | Organizers | Game night: attendance, schedule, scores |
| `/league/:slug/admin/night/:nightId/sheet` | Organizers | Printable / shareable schedule sheet |

Legacy token-in-URL admin paths redirect to the Auth-based routes above.

## Project structure

```
src/
  api/leagueApi.ts          # Supabase queries + RPCs
  auth/                     # Auth context, JWT refresh helpers
  components/               # Layout, admin gate, recap, share sheet
  lib/
    schedule.ts             # Regular-night matchmaking (2v2 + fair 3v3)
    standings.ts            # Win%, sorting, playoff seeding helpers
    playoffs.ts             # Pools, round-robin, brackets
    dates.ts, errors.ts, …
  pages/                    # Home, intake, admin, game night, login
supabase/
  schema.sql                # Full schema (source of truth)
  patches/                  # Incremental SQL for live projects
vercel.json                 # SPA fallback rewrites
```

## How scheduling works (regular nights)

`buildSchedule` in `src/lib/schedule.ts`:

- Uses season history + tonight’s partners/opponents for variety
- When attendance is `n % 4 === 2` or `3`, one court is **3v3**
- Biases 2v2 picks so players with more 3v3 games tonight prefer 2v2, spreading 3v3 duty (e.g. 14 players × 5 rounds → max ~3 threes per person)

## Soft-remove vs hard-delete

Removing a player from the roster sets `players.removed_at` and clears attendance only on **future** nights. Past matches, scores, and standings stay intact. Soft-removed players are hidden from active roster UIs but still resolve in historical recaps when loaded with `includeRemoved`.

## Deployment

### Frontend (Vercel)

1. Connect the GitHub repo (`samjohnson097/devl-app`)
2. Framework: Create React App (build → `build`)
3. Env vars (Production):
   - `REACT_APP_SUPABASE_URL`
   - `REACT_APP_SUPABASE_ANON_KEY`
4. `vercel.json` rewrites all routes to `index.html` for client-side routing

Pushes to `main` trigger a new deploy. **SQL/schema changes are not applied by Vercel**—run them in Supabase separately.

### Backend (Supabase)

After merging features that touch the DB:

1. Run the matching patch (or updated section of `schema.sql`) in the SQL editor
2. Confirm Auth Site URL / redirect allow-list includes the Vercel domain
3. For winners photos, ensure the `season-winners` bucket exists and is public-read (see patch `005`)

## Security model (short)

- **Anon**: read public season data via RLS (`hide_from_public` seasons are hidden from logged-out users); can call intake/register RPCs and submit feedback
- **Authenticated**: organizer RPCs (`assert_authenticated`) for schedule, roster, scores, settings, Storage uploads
- Secrets (e.g. legacy admin tokens) live in `season_secrets`; the app uses Auth sessions for admin UI

Never put the Supabase **service role** key in the React app.

## Common workflows

**Start a season**  
Sign in → home → create season (name, first Monday, games per night) → share `/league/:slug/join`.

**Game night**  
Admin → Nights → open/create night → set attendance → Generate schedule (or Add match manually) → enter scores.

**Cancel a Monday**  
Settings → Cancel a week & add a make-up week → pick the Monday. That date is removed; other Mondays keep dates and availability; a new final Monday is appended (unchecked).

**Update player availability after a schedule change**  
Player opens intake → same email → Load my schedule → adjust Mondays → Submit.

**End of season photos**  
Admin → Settings → Champions photos → upload gold/silver → appear on the home page for that season.

## Troubleshooting

| Symptom | Likely fix |
| --- | --- |
| “Supabase is not configured” banner | `.env.local` missing or restart `npm start` after editing env |
| RPC / column errors after a feature ship | Apply the matching `supabase/patches/*.sql` |
| Intake creates duplicates | Email required for updates; apply patch `003` |
| Winners upload fails | Apply `005` (+ `006` for 20 MB); confirm Storage policies |
| Admin routes bounce to login | Sign in at `/admin/login`; check Auth redirects |

## License

Private / unpublished unless you add a license file.
