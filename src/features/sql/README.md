# src/features/sql: the host database

Scripts for the MyTechgacity database (`mvp-techgacity` on
`dev-techgacity-sqlserver`), run in SSMS. They give the two tabs a place to
keep drivers and stays. Lookup tables (`fk_…`) are created through the app's
interface; everything else is created here.

## Run order

| Step | Where | What |
|---|---|---|
| 1 | the app | `fk_Home_Time_Status` (REQUESTED … CANCELLED) and `fk_Home_Time_Source` (GEOTAB, DISPATCH): both done |
| 2 | mvp-techgacity | `01_DRVR_Drivers.sql`: creates `DRVR.Drivers`. Once. |
| 3 | **Millstream** | `drivers_to_drvr.sql`: *generates* the copy. Results to Grid, select the column, copy. |
| 4 | mvp-techgacity | Paste the generated script and run it. Re-run steps 3 and 4 whenever drivers change; it is safe to repeat. |
| 5 | mvp-techgacity | `02_DRVR_Home_Time_Stays.sql`: creates `DRVR.Home_Time_Stays`. Once. |
| – | mvp-techgacity | `03_scoped_reads.sql`: not setup. It holds the API's four reads, each with its "who" check, runnable here to try them. |

Each setup script refuses to run twice and says what it needs if a step was
skipped.

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

One setting to know about: every script sets `QUOTED_IDENTIFIER ON`. The
filtered index on `DRVR.Drivers.User_Uuid` needs it to be created and to
write to the table afterwards. SSMS turns it on by default; `sqlcmd` does
not, and the first test run failed there without it.
