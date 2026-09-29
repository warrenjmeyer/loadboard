# Get Me Home Planner

A dispatch page. For every driver it answers two questions: **can they get
home by the time they asked for, and when does dispatch have to start routing
them there?** Drivers with no request open are checked against how long they
have been out.

It is being designed in the load board and will move to the MyTechgacity
component page, where it becomes the **Get Me Home Planner** tab. This folder
is built to make that move by copying files. Nothing in it imports from the
rest of the load board, and the only thing the host has to write is an
*adapter* that supplies the data.

It is **TypeScript**, like the host. (The rest of the load board is
JavaScript; `src/features/tsconfig.json` type-checks this folder and the
features beside it.) The settings are
Vite's standard React + TypeScript template with strict mode on, and it
type-checks cleanly under both TypeScript 5.9 and 7.

The look is not final. It uses MUI because the host does, so the components
move over unchanged. Colours and type come from whatever theme the host
wraps it in.

## See it

    npm run dev
    http://localhost:5173/get-me-home.html

That page exists only on the dev server: `vite build` compiles `index.html`
and nothing else, so neither this page nor its data ever reaches the
deployed site. A switch at the top picks where the drivers come from:

- **Sample drivers**: nine made-up drivers from `fixtures/roster.json`, one
  for every status, on a fixed clock. The page to design against. Their
  home time comes from the Driver Home Time Schedule tab's sample stays, so
  deciding a request there changes this tab
  (`src/features/preview/wiring.ts`).
- **Live: API and GeoTab** (`?source=live`): the load board's real drivers
  and loads, with positions and hours from GeoTab, read through the deployed
  API. It needs a dispatcher or admin signed in on the dev server. Open
  `http://localhost:5173/signin` first; the dev server lets sign-in through,
  and still refuses every other write. Nothing records home time yet, so
  live drivers have no request and no days-out count.

    node --test src/features/get-me-home/planHome.test.ts src/features/get-me-home/statusTable.test.ts src/features/get-me-home/adapters/loadboardRoster.test.ts
    npm run typecheck                                       # the types
    node src/render.check.mjs                               # every screen state renders

## What is here

| File | What it is | Ports? |
|---|---|---|
| `index.ts` | The public names: every module, every piece, the types. Import from here. | yes |
| `modules.ts` | The register of modules (below). | yes |
| `GetMeHomePlanner.tsx`, `PlannerRoster.tsx`, `DriverTripHome.tsx` | The loading wrappers: each reads its slice and draws its piece. | yes |
| `PlannerView.tsx`, `RosterTable.tsx`, `DriverPlan.tsx`, `StatusChip.tsx` | The pieces: draw from props, fetch nothing. | yes |
| `useRosterRead.ts` | The loading pattern the wrappers share. | yes |
| `planHome.ts` | **All the rules**, and the types of what they produce (`Plan`, `Schedule`, `Status`). No React, no runtime imports. | yes, unchanged |
| `contract.ts` | The types of the data the planner needs (`Roster`, `Driver`, `Adapter`), plus `checkRoster()` to test real data against them. | yes |
| `statusTable.ts` | Keeps the planner's statuses and the `DRVR.fk_get_me_home_status` table in step: `checkStatusRows()`, `statusIds()`. | yes |
| `status.ts`, `format.ts` | Labels, colours (palette names), date and duration formatting. | yes |
| `planHome.test.ts`, `statusTable.test.ts` | 31 tests. Run them after the port to prove it. | yes |
| `fixtures/roster.json` | A complete, valid sample roster. The tests use it. | yes |
| `fixtures/statuses.json` | The status table's rows exactly as the app created them on 2026-09-29. | yes |
| `adapters/fixtureAdapter.ts` | Serves the sample roster. Also the template for a real adapter. | no |
| `adapters/loadboardAdapter.ts`, `loadboardRoster.ts`, `dockTime.ts` | The load board's live adapter: its API and GeoTab, turned into a `Roster`, with 11 tests. **The worked example of a real adapter**: what to fetch, how a place gets coordinates, how a dock's local time gets a zone. | no, but read it |


The preview page and the tsconfig live one level up, in `src/features/`,
because they serve every feature built here for MyTechgacity; neither ports.

## The modules

Each is a loading wrapper (reads its slice, handles loading and errors)
around a piece (draws from props). All are exported, demoed on the modules
page (`/get-me-home.html?page=modules`) and listed in `modules.ts`. See
`src/features/README.md` for the rule.

| Module | Piece | Reads | What it is |
|---|---|---|---|
| `GetMeHomePlanner` | `PlannerView` | `loadRoster` | The whole tab: the roster, and the chosen driver's trip home beside it |
| `PlannerRoster` | `RosterTable` | `loadRoster` | The table alone, calling `onSelect` with a driver code |
| `DriverTripHome` | `DriverPlan` | `loadDriver` | One driver's trip home, reading that driver alone |
| `StatusChip` | (is its own piece) | nothing | A status, or a count of them |

## Porting it

1. **Copy the folder**, leaving out `adapters/`. The adapters are the load
   board's side of the handshake; the host writes its own.
2. **Dependencies:** React 18 or later, and `@mui/material` 5 or later with
   emotion. It uses only core components (Box, Stack, Table, Card, Chip,
   Alert, Tooltip, LinearProgress, Button, Typography). Everything is styled
   through `sx` with palette names. There is no Grid, no icon package and no
   stylesheet.
3. **TypeScript settings.** Imports spell out their extensions
   (`'./planHome.ts'`), because plain Node needs them to run the tests. That
   needs `allowImportingTsExtensions`, which Vite's React + TypeScript
   template already turns on. If yours doesn't, turn it on, or find and
   replace `.ts'` and `.tsx'` in the imports. The code uses no enums or
   namespaces, so it also passes `erasableSyntaxOnly`.
4. **Run the tests** with `node --test planHome.test.ts statusTable.test.ts`. That needs Node
   22.18 or later, which runs TypeScript directly; on older Node, run them
   under Vitest. If they pass on your side, the rules came across intact.
5. **Write the adapter.** It is one object with two scoped reads: the
   roster, and one driver as a roster of one. The `Adapter` type says exactly
   what each takes and returns:

   ```ts
   import type { Adapter, Roster } from './get-me-home'

   export const adapter: Adapter = {
     async loadRoster({ organizationId, signal }) {
       const { data } = await api.get<Roster>('/get-me-home/roster', { params: { organizationId }, signal })
       return data // shaped as contract.ts says, or mapped into that shape here
     },
     async loadDriver({ organizationId, driverCode, signal }) {
       const { data } = await api.get<Roster>(`/get-me-home/drivers/${driverCode}`, { params: { organizationId }, signal })
       return data // { drivers: [] } for a driver who is not there
     },
   }
   ```

   The types only describe what the server *should* send, and
   `api.get<Roster>` believes it without looking. `checkRoster` looks at what
   it actually sent:

   ```ts
   const problems = checkRoster(await adapter.loadRoster({ organizationId, signal: new AbortController().signal }))
   ```

   It returns a list of problems in plain sentences. An empty list means the
   planner will understand every field.
6. **Mount it in the tab**, inside your ThemeProvider:

   ```tsx
   <GetMeHomePlanner adapter={adapter} organizationId={activeOrganizationUuid} />
   ```

   Define the adapter at module scope or in `useMemo`. A new adapter object on
   every render means a new request on every render.
7. **Access control is yours.** This is a dispatch page. The planner shows
   whatever roster it is handed and checks no roles itself.

Already loading the data some other way (react-query, a parent component)?
Skip the adapter and render `<PlannerView roster={roster} loading={...} error={...} />`.

## The data

`contract.ts` has the full definitions as TypeScript types, each field
documented. In short, a `Roster` is `{ asOf?, policy?, drivers: Driver[] }`,
and each `Driver` is:

| Field | What | Notes |
|---|---|---|
| `driverCode`, `name` | who | required |
| `jobType` | `OTR` / `Regional` / `Dedicated` / `Local` | picks the days-out limit |
| `unitNo` | the truck | display only |
| `home` | `{ place, latitude, longitude }` | required; needs coordinates to plan |
| `position` | `{ near, latitude, longitude, reportedAt }` or null | from the ELD/telematics |
| `hours` | `{ driving, duty, cycle, rest }` **in seconds left**, or null | from the ELD |
| `currentLoad` | `{ id, finalStop: {place, latitude, longitude}, emptyAt }` or null | the trip home starts after this |
| `routeHome` | `{ miles, driveSeconds, source }`, optional | a real truck route; without it the planner estimates |
| `homeTime` | `{ lastHomeAt, requestedBy, note }` | the Driver Home Time Schedule's data |

**Units are where ports go wrong.** Durations are *seconds*, times are ISO 8601
*with a zone* (`...Z` or `...-05:00`), and coordinates are decimal degrees.
`checkRoster` catches a missing zone, and hours sent where seconds belong.

### Where each field comes from, and what is missing

This is most of the real work of the port. The screen moves over quickly;
the data behind it has to come from somewhere.

- **home**: the load board has each driver's address (city, state, postal
  code) but no coordinates. Somebody has to geocode it, once per address.
- **position, hours**: in the load board these come from Geotab
  (`DeviceStatusInfo`, `DutyStatusAvailability`, whose TimeSpans are
  converted to seconds). The host needs the same from whichever ELD it uses.
- **currentLoad**: from the TMS: the load's last stop, and when it will be empty there.
- **homeTime**: **does not exist anywhere yet.** Last-home dates and open
  requests are what the Driver Home Time Schedule tab would keep. Decide
  where that lives before building either tab.
- **routeHome**: optional. In the load board, truck routes come from HERE on
  the server, because each call is billed and the key must stay secret.
  Leave it out and the planner estimates (straight line × 1.2 at 50 mph),
  labelling the result as an estimate.

## How it decides

| Code | Shown as | Means |
|---|---|---|
| `LATE` | **Won't make it** | Can't be home by the requested time, even leaving now. |
| `TIGHT` | **Route home now** | Can make it, with less than 12 hours to spare. |
| `OVERDUE` | **Overdue home** | No request open, and out longer than policy allows. |
| `NOLOCATION` | **Can't place** | No position and no current load, so there is no trip to plan. |
| `SOON` | **Due home soon** | No request, close to the days-out limit. |
| `ONTRACK` | **On track** | Makes the request with 12+ hours to spare. |
| `ONTHEROAD` | **On the road** | No request, well inside the limit. |
| `HOME` | **Home** | Empty, and within 25 miles of home. |

The roster sorts in that order, least spare time first within a status.

### The status lookup table

The codes are the rows of `DRVR.fk_get_me_home_status`, a lookup table the
stakeholder created through the app. It exists so that anything which
*stores* a status (a saved plan, a home-time request) can hold it as a
foreign key. The planner itself stores nothing; it works the status out on
every load.

- **Rows are matched by name** (the `fk_get_me_home_status` column), never by
  `fk_get_me_home_status_Id` or `Choice_Key`. The app hands out both Ids and
  keys in the order rows are created (1–8 and `a`–`h`), so a database built
  in a different order would disagree on them. The name is what a person
  chose.
- **The table holds codes; the words a dispatcher reads live in `status.ts`**,
  alongside the colours.
- **Row 0, `Undefined`**, is the app's placeholder in every lookup table (the
  column default). It is not a status and is ignored.
- **To store a status as a foreign key**, `statusIds(rows)` gives the Id for
  each code: `LATE` → 1, …, `HOME` → 8 in the current table.
- **Keeping them in step.** The table is edited through the app and the
  rules live in code, so nothing else stops them drifting.
  `checkStatusRows(rows)` compares the table's actual rows (from `SELECT *`)
  with the planner and lists every mismatch: a renamed row, a missing or
  extra one, a duplicate, a status switched off. Run it after the port and
  whenever someone edits the table. Adding a status means a new row *and* a
  new rule in `planHome.ts`; either one alone shows up here.

**Hours of service.** Uses the US property-carrying rules: 11 hours driving
inside a 14-hour window, then a 10-hour rest; a 30-minute break after 8
hours of driving; a 70-hour cycle, then a 34-hour restart. Every
simplification pushes the arrival *later*, never earlier. The 70-hour cycle
never recovers except through a restart. With no hours data the trip starts
with a 10-hour rest, and a driver still on a load is assumed to rest after
delivering unless the host sends `hoursAtEmpty`. A plan that is early is a
pleasant surprise; one that is late is a broken promise to someone's family.

**Days out.** Home time is company policy, not federal law. The defaults
(OTR 21 days, Regional and Dedicated 7, Local 1) are the typical figures
from the CDL Hometime Guide. A roster's `policy` overrides any of them.

## The sample drivers

| Driver | The case |
|---|---|
| Terrell Boone | Laredo to Waterloo by Tuesday: 1,300 miles, can't be done |
| Hollis Barnett | Kansas City, nearly out of hours, needs to go now |
| Dale Foster | Out of cycle; the 34-hour restart is what makes it tight |
| Rosa Delgado | Still delivering in Joliet; overdue, trip home starts after the drop |
| Rey Vasquez | Truck never reports, not on a load: can't place |
| Lena Hartman | No hours data and a 4-hour-old position, both flagged |
| Alma Cortez | Denver to Dubuque with plenty of time |
| Priya Raman | Carries a real truck route (`routeHome`) instead of an estimate |
| Sherman Oaks | Local driver, already home |

## Questions for the MyTechgacity team

1. Which versions of React, MUI and TypeScript? (It is TypeScript, according to
   the source map the live site serves.)
2. Which ELD or telematics source provides positions and hours of service?
3. Where will home-time records live, and are they shared with the Driver Home Time Schedule tab?
4. Is there a truck-routing service available on the server (HERE, PC*MILER, Trimble)?
5. Times show in the viewer's time zone. Is that right for their dispatchers?
