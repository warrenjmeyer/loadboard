# Driver Home Time Schedule

The second tab on the MyTechgacity component page. Drivers ask to go home;
dispatch answers; the schedule keeps track of who is home when. It is also
where the Get Me Home Planner gets the two facts it cannot work out for
itself: **when each driver was last home**, and **when they have asked to
be home by**.

Built the way the planner is: its own TypeScript folder, a contract, pure
rules with tests, and sample data. It moves to the host by copying files;
nothing in it imports the planner or the rest of the load board.

## See it

    npm run dev
    http://localhost:5173/get-me-home.html?tab=schedule

A switch at the top shows it as **Dispatch** or as a **Driver**. The stays
are samples on the planner's clock (Monday 28 September, 10 AM). Approving,
declining and requesting really change them, and the planner tab with them,
until the page is reloaded. Nothing stores home time for real drivers yet.

    node --test src/features/home-time-schedule/rules.test.ts src/features/home-time-schedule/lookups.test.ts src/features/home-time-schedule/scope.test.ts src/features/sampleData.test.ts
    npm run typecheck

## One record is one stay

| Status | Means | Set by |
|---|---|---|
| `REQUESTED` | The driver asked | driver |
| `APPROVED` | Dispatch said yes | dispatch |
| `HOME` | The driver got there (`arrivedAt`) | GeoTab, or dispatch |
| `DONE` | The driver left again (`leftAt`) | GeoTab, or dispatch |
| `DECLINED` | Dispatch said no, with a reason the driver sees | dispatch |
| `CANCELLED` | Withdrawn before it happened | either |

A stay keeps what was **asked** (`homeBy`, `backOut`) apart from what
**happened** (`arrivedAt`, `leftAt`). There is no way back from DONE,
DECLINED or CANCELLED. A change of plan is a new request, which keeps the
record of what was asked and what was said. `MOVES` in `rules.ts` is the
whole list of what may go where, and the screens offer only those moves.

**The status lookup table** is `DRVR.fk_Home_Time_Status`, created through
the app on 2026-09-29 (`fixtures/statuses.json` holds its rows as created).
Unlike the planner's statuses, these are *stored*: a stay's status column is
the foreign key the table exists for.

- **Rows are matched by name** (`Home_Time_Status`), never by
  `Home_Time_Status_Id` or `Choice_Key`, because the app hands those out in
  creation order (1–6, `a`–`f`).
- **`statusIds(rows)`** gives the Id to store: `REQUESTED` → 1 … `CANCELLED` → 6.
- **Row 0, `Undefined`**, is the app's placeholder and the column default:
  "not set", not a status.
- **`checkStatusRows(rows)`** compares a real `SELECT *` with the schedule
  and lists every disagreement: a renamed, missing, extra, duplicated or
  inactive row. Run it after the port and whenever someone edits the table.

## What the planner gets

`homeTimeFor(stays, driverCode, now)` gives the planner's `homeTime`:

- **`lastHomeAt`**: when they last *left* home (the latest DONE), or now if
  they are home.
- **`requestedBy`**: the earliest home-by among REQUESTED and APPROVED stays.
- **`note`**: that request's reason.

The Driver Load Plans take the `APPROVED` and `HOME` stays as the home time
a load must not run into (see `../driver-load-plans/README.md`). Approving a
request here changes which drivers are suggested there.

## The modules

Each is a loading wrapper (reads its slice, handles loading and errors)
around a piece (draws from props). All are exported, all have a live demo on
the modules page (`/get-me-home.html?page=modules`), and all are listed in
`modules.ts`. See `src/features/README.md` for the rule.

| Module | Piece | Reads | What it is |
|---|---|---|---|
| `HomeTimeSchedule` | `ScheduleView` | via its two modules | The whole dispatch tab: `DecisionQueue` above `ScheduleBoard`, under one `ScheduleSync` |
| `DecisionQueue` | `DecisionList` | `loadQueue` | Requests waiting, oldest first, with Approve, Decline and the planner's verdict |
| `ScheduleBoard` | `Board` | `loadBoard` | Two weeks of who is home when, with a count per day |
| `StayDetails` | `StayDialog` | `loadStay` | One stay by id, with the moves its status allows |
| `DriverHomeTime` | `DriverStays` | `loadDriverStays` | The driver's side: their stays, dispatch's answers, a request form |
| `RequestHomeTime` | `RequestForm` | `loadDriverStays` | A "Request home time" button and its form |

**Scoped reads.** The adapter has one read per screen, never "load
everything". `scope.ts` says exactly what each read returns, and
`scope.test.ts` pins it down, including that a driver's read carries no
other driver's stays. **Modules on one page stay in step** under a shared
`<ScheduleSync>`: an action in one makes all of them read again.

## Porting it

1. **Copy the folder**, leaving out `adapters/` (the sample adapter).
2. **Write the adapter** (`ScheduleAdapter` in `contract.ts`). It has four
   scoped reads (`loadQueue`, `loadBoard`, `loadDriverStays`, `loadStay`)
   answering exactly as `scope.ts` does, and two writes, `requestStay` and
   `actOnStay`. The server should run the same `applyAction` and
   `checkNewStay` the sample adapter does, and it is where "a driver may only
   read and touch their own stays" is enforced; the screens don't offer more
   than a role should do, but they are not the guard. `checkSchedule()` tests
   real data against the contract.
3. **Mount the modules**: `<HomeTimeSchedule adapter verdictFor />` in the
   tab, `<DriverHomeTime adapter driverCode />` wherever drivers work, or any
   of the others on their own.
4. **Join it to the planner**, where the host has both. Feed the planner's
   `homeTime` from `homeTimeFor`, and pass `verdictFor`, which plans the
   driver against a request's home-by. `src/features/preview/wiring.ts` is
   the worked example; TypeScript checks the join there.

5. **Run the GeoTab check on a timer** (below).

## GeoTab marks arriving and leaving

Decided 2026-09-29: HOME and DONE set themselves from GeoTab, and dispatch
corrects rather than enters. `detectHomeMoves(stays, fixes, homes, { now })`
takes each truck's recent GPS fixes and returns the moves they prove, in
the order they happened:

- **Home** means within **25 miles** of the driver's home town, the
  planner's own definition of HOME, so the two tabs agree.
- **Half an hour** on one side of that line before it counts. Driving
  through town is not coming home, and a fuel stop just outside is not
  leaving.
- **Only APPROVED stays arrive.** A truck at home without an approved stay
  is a conversation for dispatch, not something to record on their behalf. A
  driver who got home before Approve was clicked still arrived when they
  arrived.
- **Every arrival and departure says who recorded it** (`arrivedSource`,
  `leftSource`: `geotab` or `dispatch`), and the stay's dialog shows it.
  **Correct times** fixes either one and relabels it as dispatch's.

On the host this is a server job on a timer, say every ten minutes. Fetch
the fixes since the last run (GeoTab `LogRecord`s for trucks with an
APPROVED or HOME stay), call `detectHomeMoves`, and apply each move with
`applyAction(stay, move.action, { now, by: null, source: 'GEOTAB' })`. A
move that has been applied is never suggested again, because the stay's
status has moved on.

The sample clock is Monday morning, and no approved stay is due home by
then, so the preview shows the results (Marcus Webb's arrival, Sherman
Oaks's night at home) rather than the check running. The tests run it:
coming home, staying, leaving, a drive-through that must not count, and a
driver who beat the approval.

## Decided

1. **Time zones: the viewer's.** The dispatcher's board shows the
   dispatcher's zone, as the planner does. A driver's own screen shows the
   zone their phone is in.
2. **GeoTab marks arriving and leaving**, with dispatch correcting (above).
3. **No limits** on how long, how soon, or how many at once. The board's
   daily count stays informational.
