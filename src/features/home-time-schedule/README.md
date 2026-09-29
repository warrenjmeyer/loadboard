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

    node --test src/features/home-time-schedule/rules.test.ts src/features/home-time-schedule/statusTable.test.ts src/features/sampleData.test.ts
    npm run typecheck

## One record is one stay

| Status | Means | Set by |
|---|---|---|
| `REQUESTED` | The driver asked | driver |
| `APPROVED` | Dispatch said yes | dispatch |
| `HOME` | The driver got there (`arrivedAt`) | dispatch, later GeoTab |
| `DONE` | The driver left again (`leftAt`) | dispatch, later GeoTab |
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

## The screens

- **Dispatch** (`HomeTimeSchedule`): requests needing a decision, oldest
  first, each with the planner's verdict above Approve; a two-week board of
  who is home when, with a count of drivers home each day; and a dialog per
  stay offering the moves its status allows.
- **Driver** (`DriverHomeTime`): their own stays, dispatch's answers
  including any decline reason, and a request form. The rules check the
  request before it is sent: in the future, back out after home by, not on
  top of another stay.

## Porting it

1. **Copy the folder**, leaving out `adapters/` (the sample adapter).
2. **Write the adapter** (`ScheduleAdapter` in `contract.ts`): one read,
   `loadSchedule`, and two writes, `requestStay` and `actOnStay`. The server
   should run the same `applyAction` and `checkNewStay` the sample adapter
   does, and it is where "a driver may only touch their own stays" is
   enforced; the screens don't offer more than a role should do, but they
   are not the guard. `checkSchedule()` tests real data against the
   contract.
3. **Mount it**: `<HomeTimeSchedule adapter verdictFor />` in the tab, and
   `<DriverHomeTime adapter driverCode />` wherever drivers work.
4. **Join it to the planner**, where the host has both. Feed the planner's
   `homeTime` from `homeTimeFor`, and pass `verdictFor`, which plans the
   driver against a request's home-by. `src/features/preview/wiring.ts` is
   the worked example; TypeScript checks the join there.

## Open questions

1. **Time zones.** The screens show the viewer's zone, as the planner does.
   A request is really about the driver's home zone. For a Midwest fleet
   with Midwest dispatch they agree; if not, which should the board show?
2. **Automatic arrive and leave.** GeoTab can see a truck enter or leave the
   home-town zone. Should HOME and DONE set themselves, with dispatch
   correcting instead of entering?
3. **Limits.** Is there a longest stay, a minimum notice, or a cap on how
   many drivers may be home at once? The board's daily count is ready for a
   cap.
