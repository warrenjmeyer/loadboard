# Driver Master

The tab where drivers are kept: who they are, where they live, what they
drive, and (for an admin) how they are paid. It edits `DRVR.Drivers`, the
table every other tab reads. The planner and the schedule take a driver's
home from **City** and **State**, and the planner takes how long they may be
out from **Job**. So this tab is where those facts get put right.

Built the way the other tabs are: its own TypeScript folder, a contract, pure
rules with tests, sample data, and reusable modules from the first file. It
moves to the host by copying files, and imports nothing from the other tabs
or the load board.

## See it

    npm run dev
    http://localhost:5173/get-me-home.html?page=modules#DriverMaster

Each demo can be switched between **as an admin** and **as dispatch**, so you
can see the pay section come and go. The drivers are the other tabs' ten
sample drivers, plus one who has left (Kurt Miller). Saving, adding and
marking someone as left really change them until the page is reloaded.

    node --test src/features/driver-master/rules.test.ts src/features/driver-master/scope.test.ts src/features/sampleData.test.ts
    npm run typecheck

## Who may do what

Decided 2026-10-12:

| | Dispatch | Admin | A driver |
|---|---|---|---|
| See the list, open a driver | yes | yes | refused |
| Change name, address, job, truck | yes | yes | refused |
| Mark as left, bring back | yes | yes | refused |
| See and change pay, the SSN, company/owner | **no** | yes | refused |
| Add a driver | no | yes | refused |

Adding is admin-only because a driver can't be stored without their pay,
and only an admin sees pay.

**The server keeps pay private, not the screen.** `09_driver_reads.sql`
returns NULL in the pay columns for anyone but an admin, so the pay never
leaves the database. `10_driver_writes.sql` refuses pay from anyone else.
The screen follows the answers it gets. The form draws the pay section only
when the driver arrived with pay. The list offers *Add driver* only when it
says `you.canAdd`. The same `DriverMaster` component serves as both
dispatch's tab and admin's.

The list never carries an address, SSN or pay, whoever asks: it is for
finding a driver. `checkDriverList` refuses a list that does.

## Rules worth knowing

- **A driver code never changes, and is never reused.** It's the link to the
  load board, GeoTab and every other tab. Even a driver who has left keeps
  theirs. A new one is suggested in the house style (`TBOONE`, then
  `TBOONE2`).
- **A driver is never deleted**, because their stays and load plans point at
  them. *Mark as left* sets `IsActive = 0`. They drop off the planner, the
  schedule and the load plans, and *Bring back* undoes it.
- **A save is checked against the version that was read.** If someone else
  saved in between, the save is refused ("…changed by someone else since you
  opened it") rather than quietly undoing their change. The version is
  `Updated_At` to the millisecond.
- **An owner/operator has a pay basis, a company driver none.** This is the
  load board's `CK_Drivers_paybasis`, which `DRVR.Drivers` doesn't have as a
  constraint. `10` enforces it instead.
- **Job decides home time.** The form says how the planner will count the
  job typed (OTR, Regional, Dedicated, Local, or the default).
  `homeTimeRule` is the planner's `jobTypeOf` written again, and
  `sampleData.test.ts` checks that the two agree.

## Modules

| Module | Piece | Reads |
|---|---|---|
| `DriverMaster`: the whole tab | `DriverMasterView` | `loadDriverList`, `loadDriver` |
| `DriverDirectory`: the list | `DriverTable` | `loadDriverList` |
| `DriverEditor`: one driver, or a new one | `DriverForm` | `loadDriver` |

`DriverEditor` draws inline, not in a dialog. `DriverMaster` puts it in one,
and a host could put it on a driver's own page instead.

## The host's SQL

`src/features/sql/09_driver_reads.sql` (the two reads) and
`10_driver_writes.sql` (save, add, active), each with its WHO check. The API
fills `@CallerUuid`, `@CallerIsDispatch` and `@CallerIsAdmin` from the
session. For a write, the API reads the driver, runs the change through
`rules.ts` (`applyChanges`, `checkNewDriver`), and passes the whole driver
to `10`, as the schedule's API does with `07`. On the laptop,
`tools/local-db/plugin.mjs` does exactly that
(`/local-db/driver-master/...`), and `preview/laptopAdapters.ts` has
`laptopDriverAdapter.dispatch` and `.admin`.

Tested 2026-10-12 on the laptop's `mvp-techgacity`, through the dev server:

- Reads as dispatch carry no pay. As admin they do. A driver is refused.
- A stale version is refused, and so is pay from dispatch.
- An owner with no basis is refused.
- Adding a code that is taken is refused, and adding is refused to dispatch.
- Leaving and coming back work.

Every change was put back afterwards.

## Not done yet

- **Linking a sign-in** (`User_Uuid`). The list and form show *No sign-in*,
  but linking one needs the host's users, which this repo can't see.
- **A driver seeing their own record.** Every read refuses drivers today. If
  they should see their own address, that is a new read (`loadMyDriver`),
  scoped to the signed-in driver.
- **The drivers copy now overwrites edits.** `drivers_to_drvr.sql` updates
  every column it carries from Millstream. Re-running it after someone has
  edited a driver here puts Millstream's values back. Once this tab is in
  use, `DRVR.Drivers` is the master, so stop re-running the copy, or run it
  for new drivers only.
