# src/features: built for MyTechgacity

Each folder here is one tab of the MyTechgacity component page, designed in
the load board and ported to MyTechgacity by copying the folder. Nothing in a
feature folder imports another feature folder or the load board's own
JavaScript.

| Folder | What it is |
|---|---|
| `get-me-home/` | The Get Me Home Planner |
| `home-time-schedule/` | The Driver Home Time Schedule |
| `driver-load-plans/` | The Driver Load Plans |
| `preview/` | The preview page: a stand-in for the host's tabs, and the modules page. Deployed on sample data only; not ported. |
| `tsconfig.json` | Type-checks all of the above (`npm run typecheck`). Not ported; the host has its own. |
| `modules.test.ts` | Enforces the module rule below. |
| `sampleData.test.ts` | Checks the three tabs' sample data tell one story, and the hours join between the planner and the load plans. |

    npm run dev
    http://localhost:5173/get-me-home.html                 the host's tabs
    http://localhost:5173/get-me-home.html?data=laptop     the same, on the laptop database
    http://localhost:5173/get-me-home.html?page=modules    every module, with a live demo

## The laptop database

"Sample data / Laptop database" at the top of the preview switches every tab
between made-up data held in memory and the laptop's own `mvp-techgacity`
(built by `sql/local_stand_in.sql`; see `sql/README.md`). On the laptop
database the tabs read and write real rows **through the host's own SQL**:
`03` and `07` for the schedule, `05` and `06` for the load plans. The dev
server runs them (`tools/local-db/plugin.mjs`), filling in each script's
"Try it" values, so what is tried here is the text the host will run, who-may
checks included. The schedule's moves go through its rules first
(`applyAction`, `checkNewStay`), as the host's API must. `vite build` never
includes any of it.

What the database does not hold comes from GeoTab through the deployed API,
as the host's API would add it: truck positions, hours, and town locations.
That needs a dispatcher or admin signed in on the dev server; the page says
who is signed in. Without it the loads and stays still come through, and each
check says it cannot tell. The planner tab needs it for everything.

The driver view acts as the chosen driver (each laptop driver has a made-up
user from `sql/local_test_users.sql`), so a driver asking for anyone else's
stays is refused by the same check the host runs.

`preview/laptop.ts` turns the rows into the tabs' data (and is tested in
`preview/laptop.test.ts`); `preview/laptopAdapters.ts` does the asking. Both
are the worked example of what the host's API has to do with its rows.

## Every addition is a reusable module

A standing requirement, set 2026-09-29, for everything here, including tabs
not yet built. A module is:

- **A piece**: a presentational component. Props in, JSX out, nothing
  fetched. A host that already has the data renders the piece.
- **Its loading wrapper**: takes the adapter and the scope it needs (a driver,
  a stay, a date window), reads **only** what its screen shows through a
  **scoped adapter read**, handles loading, errors and refresh, and renders
  the piece. A host that wants the whole thing mounts the wrapper.

A piece that shows no data (`StatusChip`) is its own module, with no
wrapper.

### Scoped reads

Adapters have one read per screen, never one "load everything". The
schedule's adapter has `loadQueue`, `loadBoard` (a date window),
`loadDriverStays` (one driver) and `loadStay` (one stay). `scope.ts` says
exactly what each returns, as pure functions. The planner's adapter has
`loadRoster` and `loadDriver`. The load plans' has `loadPlanBoard` (a
week), `loadDriverPlan` (one driver), `loadOpenLoads` (a week of open loads)
and `loadCandidates` (one load, and what ranking drivers for it takes).

Scoping keeps a queue of three from shipping a year of history, and it keeps
a driver's screen from receiving other drivers' stays. A scoped answer carries
what its screen still needs from outside the scope; each driver on the board
comes with `lastHomeAt`, for example.

**Scoping is not the guard.** Each read's doc comment in `contract.ts` says
who may call it. For example, `loadDriverStays` is for dispatch, or for that
driver with their own code. The server enforces this from the signed-in
user, because a request can be written by hand. Checked on 2026-09-29: the
driver screen makes one read, `loadDriverStays`, for its own driver, and
receives that driver's stays and no one else's.

### Modules that share a page

Modules that each read their own slice stay in step through a shared
version, not a shared dataset. Put them under one `<ScheduleSync>`: an
action in any of them calls `changed()`, and all of them read again.
`HomeTimeSchedule` is just `DecisionQueue` and `ScheduleBoard` under one
`ScheduleSync`. Mount them apart and nothing is lost.

### The register, and the test that holds it

Each feature has a `modules.ts` listing its modules: name, file, piece, the
reads it makes, a summary and a usage line. The modules page draws a card for
each, with two live demos: the module loading through a sample adapter, and
its piece alone, drawn from plain data with no adapter and no tab around it.
The second demo is the test of reuse: a piece that only works inside its tab
isn't reusable yet. `modules.test.ts` fails when any of these happens:

- a component file isn't a registered module, piece or declared support file
- a module or piece isn't exported from `index.ts`
- a declared read isn't on the adapter, or the wrapper never makes it
- a wrapper makes a read it doesn't declare, a wider read than its screen
  needs
- a piece touches an adapter
- a module has no demo, or its piece has no demo of its own

### Starting a new tab

1. A folder under `src/features/`, and a line for it in `FEATURES` in
   `modules.test.ts`.
2. `contract.ts`: the data types, an adapter with a scoped read per screen,
   and a `check…()` for data from outside.
3. Pure rules, with tests under `node --test`, and sample data in `fixtures/`.
4. For each screen: its piece, its wrapper, an entry in `modules.ts`, an
   export in `index.ts`, and a demo on the modules page. Add the pieces to
   `src/render.check.mjs`.
5. A sample adapter that answers each read with its scope and no more.

## The other rules

- **TypeScript**, strict, with erasable syntax only, so pure files run under
  plain `node --test`. Imports spell out `.ts`/`.tsx`.
- **No imports between feature folders.** They meet in `preview/`, which is
  the worked example of how the host joins them.
- **MUI through `sx` and palette names**, never hex, so the host's theme
  decides the look.
- **Times** are ISO 8601 with a zone on the wire, and shown in the reader's
  zone.
- **The preview ships on sample data only.** `vite build` compiles both
  `index.html` and `get-me-home.html`, so the stakeholder can see the tabs on
  the load board's site at `/get-me-home.html` (decided 2026-10-02). There it
  offers the made-up data alone; the laptop database and the planner's live
  data appear under `npm run dev` only (`import.meta.env.DEV` in
  `preview/PreviewHost.tsx`). Real data must never reach the deployed page.
