# Driver Load Plans

The third tab on the MyTechgacity component page, for dispatch only. It
shows what each driver is hauling this week and what is lined up next, and
puts open loads on drivers' plans. For every load it answers four questions:

1. **How many empty miles** to reach the pickup?
2. **Can they make the pickup** in its window, on the hours they have?
3. **Does it run into their home time?**
4. **Who should take it?** A suggested driver for each open load.

Built the way the other two tabs are: its own TypeScript folder, a contract,
pure rules with tests, and sample data. It was built as reusable modules from
the first file. It moves to the host by copying files, and nothing in it
imports the planner, the schedule or the rest of the load board.

## See it

    npm run dev
    http://localhost:5173/get-me-home.html?tab=loads
    http://localhost:5173/get-me-home.html?page=modules#DriverLoadPlans

A switch at the top times the legs with the **planner's hours model** or by
**driving time only**, so the difference the hours make is one click away.
The loads are samples on the planner's clock (Monday 28 September, 10 AM).
Assigning and taking back really change them until the page is reloaded.

    node --test src/features/driver-load-plans/rules.test.ts src/features/driver-load-plans/scope.test.ts src/features/driver-load-plans/lookups.test.ts src/features/sampleData.test.ts
    npm run typecheck

## A plan is loads

A driver's **plan** is the loads assigned to them: the one under way
(`In Transit`) first, then the ones lined up (`Covered`) in pickup order.
Planning means putting an `Available` load on a driver's plan, which makes
it `Covered`. Taking it back makes it `Available` again. A load already
under way cannot be taken back. `assign` and `unassign` in `rules.ts` are
the whole of it, and the server runs the same two
(`src/features/sql/06_load_plan_writes.sql`, same sentences).

## The table: DRVR.Load_Plans

Designed 2026-09-29. One row each time a load is put on a driver's plan
(`src/features/sql/04_DRVR_Load_Plans.sql`). Warren decided:

- **Planning writes only this table.** `TMS.Loads` belongs to the TMS side,
  and its `status` and `driver_code` are never written from here.
- **One step.** A row is `PLANNED`, or `TAKEN_BACK`. The statuses are the
  rows of `DRVR.fk_Load_Plan_Status`, created through the app on 2026-09-29
  (`PLANNED` = 1, `TAKEN_BACK` = 2; `fixtures/plan-statuses.json` holds the
  rows as created), matched by name (`lookups.ts`, as the schedule's are).
- **Taken-back rows are kept**, with who and when, so there is a record of
  who planned what. Putting a load on a plan again is a new row.
- **Order is by pickup time.** Nothing stores an order that could disagree
  with the windows.

| Column | What |
|---|---|
| `Load_Plan_Id` | int identity key |
| `Load_Uuid` | the load: `TMS.Loads.load_uuid` |
| `Driver_Id` | the driver: `DRVR.Drivers` |
| `Load_Plan_Status_Id` | `PLANNED` or `TAKEN_BACK` |
| `Planned_At`, `Planned_By` | when, and which dispatcher |
| `Taken_Back_At`, `Taken_Back_By` | empty while on the plan |
| the standard six | `IsActive`, `Created_At`, `Updated_At`, `Created_By`, `j`, `TTP_ID` |

What the database itself refuses: **a load on two plans at once** (a unique
index on the load, among rows not taken back, so two dispatchers clicking
Assign together cannot both win); a status that disagrees with the
take-back time; a take-back before the plan; an unknown driver, status or
load.

**Where the tab's load status comes from.** The view
`DRVR.Loads_For_Planning` gives every TMS load its state: `Delivered`,
`Cancelled` and `In Transit` from `TMS.Loads.status`, `Covered` when it is on
a plan, and `Available` otherwise. `TMS.Loads.status` still holds the load
board's words. Their own 16-state lifecycle is an open question with them,
and when it is settled, that view is the one place to change.

## The four checks

**Where a leg starts.** For a driver and a load, the truck sets off from the
latest of:

- where it is now, with the hours GeoTab reports;
- where a planned load delivers, when its delivery window closes, if that is
  before this pickup closes (hours after it: unknown);
- home, when an approved or current stay ends, if that is before this pickup
  closes (hours after it: full, if the stay was 34 hours or more, a restart).

So a driver at home starts from home when the stay ends, and a driver with
loads lined up takes the next one from where the last one leaves them.
`startFor` in `rules.ts`.

**Empty miles** are the planner's estimate: a straight line stretched by a
fifth, at 50 mph. The two tabs measure a mile the same way.

**Can they make it.** The empty miles are laid out against the driver's
hours, and the arrival is compared with the end of the pickup window:

| Verdict | Means |
|---|---|
| `ON_TIME` | Arrives with two hours or more of the window left |
| `TIGHT` | Arrives with less than two hours left |
| `LATE` | Arrives after the window closes |
| `UNKNOWN` | Can't place the truck or the pickup, and the leg says which |

**The hours model is handed in, not imported.** It is the planner's
`scheduleDrive` (11/14/70, the 30-minute break, 10-hour rests, 34-hour
restarts), and this folder may not import the planner. So the host passes it
as `drive`, a `DriveFn`. Without one, every leg is driving time only. Where
nobody knows a driver's hours (no hours from GeoTab, or after a load), the
leg is driving time only whatever the model, and says which. Hours are never
guessed.

**Home-time conflicts** are loads whose pickup-to-delivery overlaps an
`APPROVED` or `HOME` stay of the same driver. A requested stay is not a
conflict yet, and neither is a declined or finished one. Two loads of one
driver that overlap each other are flagged the same way.

**Suggesting a driver** ranks every driver for an open load. The ones who
**can take it** come first: not busy with another load then, arriving `ON_TIME`
or `TIGHT`, and clear of home time. Among those, the **fewest empty miles**
comes first, since empty miles are what dispatch is paid to keep down. The
rest follow, each with the reason. Assigning someone who can't is allowed,
but the button says **Assign anyway**.

## The sample, case by case

| Driver | Load | Shows |
|---|---|---|
| Rosa Delgado | L-30412 Peru → Joliet, `In Transit` | A load under way: no leg into it |
| Rosa Delgado | L-30418 Joliet → Davenport | The next load starting where the last one delivers, 0 empty miles |
| Hollis Barnett | L-30421 Omaha → Lincoln | **Tight** by driving time, **late** by 9½ h with his hours (1½ h of driving left) |
| Dale Foster | L-30445 Ogden → Denver | Out of cycle: a 34-hour restart first, so **late** |
| Alma Cortez | L-30425 Des Moines → Chicago | Reaches it on time, but it **runs into her approved home time** |
| Priya Raman | L-30430, L-30433 | Two loads chained; the second is **tight** (98 empty miles, an hour to spare) |
| Sherman Oaks | L-30440 Cedar Rapids → Iowa City | A local, on time |
| Marcus Webb | — | Home now: suggested for open loads from home, when his stay ends |
| Rey Vasquez | — | No position: **can't tell** |
| Lena Hartman | — | No hours from GeoTab: driving time only |
| Terrell Boone | — | Nothing planned; the Laredo load's suggested driver, until his home time is approved |

Five loads are open this week (L-30450 to L-30454), one is open but a week
out (L-30460, not shown), one is delivered and one cancelled (neither is on
any plan). **Approve Terrell's request in the schedule tab** and the Laredo
load stops suggesting him. The stays come from the schedule as they stand.

## The modules

Each is a loading wrapper (reads its slice, handles loading and errors)
around a piece (draws from props). All are exported, all have a live demo on
the modules page, and all are listed in `modules.ts`. See
`src/features/README.md` for the rule.

| Module | Piece | Reads | What it is |
|---|---|---|---|
| `DriverLoadPlans` | `LoadPlansView` | via its two modules | The whole tab: `OpenLoads` above `LoadPlanBoard`, under one `PlanSync` |
| `OpenLoads` | `OpenLoadList` | `loadOpenLoads` | Loads with no driver, picking up this week, with "Find a driver" |
| `SuggestDriver` | `CandidateList` | `loadCandidates` | Every driver ranked for one open load, with Assign |
| `LoadPlanBoard` | `PlanTimeline` | `loadPlanBoard` | Seven days of every driver's loads, empty miles and home time, with trucks free per day |
| `DriverLoadPlan` | `PlanList` | `loadDriverPlan` | One driver's plan, load by load, with Take back |
| `LegChip` | (its own piece) | nothing | A leg's verdict as a chip |

**Scoped reads.** `scope.ts` says exactly what each read returns, and
`scope.test.ts` pins it down. The open loads carry no drivers. The
candidates carry the one load and everything ranking needs, with no other
open loads. A driver's plan carries nobody else's loads. **WHO:** every read
and write is dispatch's alone. The server enforces that from the signed-in
user.

## Porting it

1. **Copy the folder**, leaving out `adapters/` (the sample adapter).
2. **Build the table** (`src/features/sql/README.md` has the order): create
   `DRVR.fk_Load_Plan_Status` through the app (`PLANNED`, `TAKEN_BACK`), run
   `04_DRVR_Load_Plans.sql`, then `load_plans_from_tms_loads.sql` to put the
   loads `TMS.Loads` already has drivers for onto their plans.
3. **Write the adapter** (`LoadPlanAdapter` in `contract.ts`). Its four reads
   are `05_load_plan_reads.sql` and its two writes are
   `06_load_plan_writes.sql`, each with its WHO check. The API adds what the
   database does not hold: a zone for each dock time (the dock's state, as
   `get-me-home/adapters/dockTime.ts` does), map positions for places, and
   each driver's position and hours from GeoTab. It trims each window to
   the exact moments with `scope.ts` once the times have zones.
   `checkLoadPlans()` tests the result against the contract, and
   `checkPlanStatusRows()` tests the lookup table.
4. **Mount it**: `<DriverLoadPlans adapter drive />` in the tab, or any
   module on its own. `DriverLoadPlan` suits a driver's page, and
   `SuggestDriver` suits a load screen.
5. **Join it to the other two tabs**, where the host has all three:
   - `drive`: the planner's `scheduleDrive`, wrapped as a `DriveFn`;
   - the stays: the schedule's `APPROVED` and `HOME` stays, reduced to
     `HomeStay`. The reads already return exactly those.

   `src/features/preview/wiring.ts` is the worked example, and TypeScript
   checks the hours join there.

## Chosen here, open to change

- **Two hours** is the line between on time and tight (`TIGHT_SECONDS`).
- **Fewest empty miles first** among drivers who can take a load, not
  "most time to spare first".
- **Assign anyway** is allowed for a driver who can't take it, as the
  schedule allows approving a request the planner says can't be made.
- **A week** from midnight today, in the viewer's time zone.
