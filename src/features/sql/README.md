# src/features/sql: the host database

Scripts for the MyTechgacity database (`mvp-techgacity` on
`dev-techgacity-sqlserver`), run in SSMS. They give the tabs a place to
keep drivers, stays and load plans. Lookup tables (`fk_…`) are created
through the app's interface; everything else is created here.

## Run order

| Step | Where | What |
|---|---|---|
| 0 | mvp-techgacity | `00_check_permissions.sql`: read-only. Says what this login may do there, and which tables already exist. Run it first. |
| 1 | the app | `fk_Home_Time_Status` (REQUESTED … CANCELLED) and `fk_Home_Time_Source` (GEOTAB, DISPATCH): both done |
| 2 | mvp-techgacity | `01_DRVR_Drivers.sql`: creates `DRVR.Drivers`. Once. |
| 3 | **Millstream** | `drivers_to_drvr.sql`: *generates* the copy. Results to Grid, select the column, copy. |
| 4 | mvp-techgacity | Paste the generated script and run it. Re-run steps 3 and 4 whenever drivers change; it is safe to repeat. |
| 5 | mvp-techgacity | `02_DRVR_Home_Time_Stays.sql`: creates `DRVR.Home_Time_Stays`. Once. |
| – | mvp-techgacity | `03_scoped_reads.sql`: not setup. It holds the API's four reads, each with its "who" check, runnable here to try them. |
| 6 | the app | `fk_Load_Plan_Status` (PLANNED = 1, TAKEN_BACK = 2): done |
| 7 | mvp-techgacity | `04_DRVR_Load_Plans.sql`: creates `DRVR.Load_Plans` and the view `DRVR.Loads_For_Planning`. Once. |
| 8 | mvp-techgacity | `load_plans_from_tms_loads.sql`: puts the Covered and In Transit loads `TMS.Loads` already has drivers for onto their plans. Safe to repeat. |
| – | mvp-techgacity | `05_load_plan_reads.sql`: not setup. The load plans' four reads, each dispatch-only. Writes nothing. |
| – | mvp-techgacity | `06_load_plan_writes.sql`: not setup. Assign and Take back. Trying it rolls back unless `@Keep = 1`. |

Each setup script refuses to run twice and says what it needs if a step was
skipped.

## On the laptop, until the host lets us create tables

`local_stand_in.sql` makes a database named `mvp-techgacity` on the laptop's
own SQL Server (localhost, Windows authentication). It holds `TMS.Loads`
shaped as theirs and the four app-made lookup tables with their exact rows.
It refuses to run on Azure SQL. Every other script runs on it unchanged, in
the host's order:

1. `local_stand_in.sql`
2. `01_DRVR_Drivers.sql`, then the drivers copy (`drivers_to_drvr.sql` on
   Millstream, its output here)
3. `02_DRVR_Home_Time_Stays.sql`, `04_DRVR_Load_Plans.sql`
4. The loads copy (`loads_to_tms.sql` on Millstream, its output here), then
   `load_plans_from_tms_loads.sql`
5. `local_shift_dates.sql`: brings the test loads into this week (laptop
   only; it refuses to run anywhere else). Re-run it after every fresh loads
   copy, which puts the old dates back.

Done 2026-09-30: 24 drivers, 230 loads, and 5 plans seeded (2 covered, 3 in
transit). The copies and the seed changed nothing on a second run. The
loads were dated Sep 9–18, and 30 of the 31 unplanned loads had no times,
so the shift moved 6 loads forward 14 days and gave those 30 pickups spread
over the week. After it, the reads for this week return 4 planned or
under-way loads and 31 open ones. One real-data quirk is left alone:
L-10416 has been In Transit since Sep 9 in Millstream, so it still reads as
picked up a week ago.

## "CREATE TABLE permission denied"

This is what `04` got on 2026-09-29 when Warren ran it: his login may read
and write `TMS.Loads` there, but not create tables. The lookup tables worked
because the app creates those with its own rights. SQL Server refused the
whole script before any of it ran, so nothing was made and nothing needs
undoing.

Two ways past it, both for whoever owns the database:

- **They grant the rights**: `00_grant_setup_rights.sql`, with the name
  `00_check_permissions.sql` shows under "you, in this database". It grants
  what the scripts need and nothing like `db_owner`. **For Warren
  (checked 2026-09-30) it comes down to one line**, since he already has
  `ALTER`, `INSERT` and `REFERENCES` on `DRVR` and `REFERENCES` on
  `TMS.Loads`: `GRANT CREATE TABLE, CREATE VIEW TO [Warren@Techgacity.com];`
- **They run the setup scripts themselves** (`01`, `02`, `04`), and grant
  only `SELECT, INSERT, UPDATE` on `DRVR`, which is enough for the copies,
  the seed, and trying the reads and writes.

Tested 2026-09-29 against a stand-in user holding Warren's rights. It was
refused, as on the host. After the grant, it ran `01`, `02`, `04`, the seed,
the reads and both writes, and still could not create anything outside
`DRVR`. The grant script refuses an empty or unknown name, and grants all
four or none.

## What crosses from the load board

Every column of `dbo.Drivers`, renamed into their Title_Case. The drivers are
made-up test drivers, so nothing is held back (decided 2026-09-29). The
table outlives the test data, though. If real drivers are ever entered
there, `SSN_Last4` and the `Pay_` columns will hold real data in another
organisation's database, and that's the time to decide whether those
columns belong there.

The copy never touches `Driver_Id`, `User_Uuid` or `IsActive`. Those belong
to their side.

## Tested (2026-09-29)

All of it was built from these files in a scratch database on the local SQL
Server, then dropped:

- The copy escapes names with apostrophes (O'Brien, Coeur d'Alene).
- All 21 columns arrive identical, compared both ways with `EXCEPT`. That
  includes the decimal pay rate and empty values, which stay empty rather
  than turning into blank text.
- A second run changes nothing, and a changed driver updates that driver's
  row only (`Updated_At` moves on that row alone).
- The stays table refuses back-out before home-by, leaving before arriving,
  an unknown driver or source, and deleting a driver who has stays.
- `datetimeoffset` keeps a home-by's `-05:00`.
- The reads refuse a driver asking for another driver's stays, or for one
  stay of theirs by id. They refuse anyone but dispatch the queue and the
  board, and a signed-in user who is not the driver.

## The load plans table (tested 2026-09-29)

Built the same way, in a scratch database with stand-ins for `TMS.Loads`
and the app-made lookup tables, then dropped:

- `04` refuses without `fk_Load_Plan_Status`, and refuses a row misspelt
  `Taken back`. With the rows right, it creates the table, the view and the
  foreign key to `TMS.Loads`, and refuses to run a second time. It is one
  batch, so a refusal stops all of it.
- The seed planned the 8 Covered and In Transit loads. It listed the one
  load whose driver is not in `DRVR.Drivers` and left it alone. A second
  run added nothing.
- The table refused a second current plan for a load, a status that
  disagrees with the take-back time, a take-back before the plan, the
  `Undefined` placeholder as a status, an unknown load or driver, and
  deleting a driver or a `TMS.Loads` row that has plans.
- The writes answered in the tab's own words ("L-30418 is Covered with
  RDELGADO now, not Available.", "…already under way; it cannot come off
  the plan."), kept the taken-back row, and changed nothing when only tried.
- **Two sessions assigning one load at once:** both passed the "is it
  Available" check, only one row was stored, and the loser was told who
  won.
- The reads returned their scopes and refused anyone but dispatch.

**Something the TMS side should know:** once the foreign key is in place, a
`TMS.Loads` row that has ever been planned cannot be deleted, even after it
was taken back. It has to be cancelled instead. `04` adds the key only when
the login running it has `REFERENCES` on `TMS.Loads`; otherwise it prints
the line, so the key can wait until the TMS side agrees to it.

One setting to know about: every script sets `QUOTED_IDENTIFIER ON`. The
filtered index on `DRVR.Drivers.User_Uuid` needs it to be created and to
write to the table afterwards. SSMS turns it on by default; `sqlcmd` does
not, and the first test run failed there without it.
