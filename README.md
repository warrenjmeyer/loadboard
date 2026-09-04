# Load Board — a React starter

A small, deliberately readable React app: fetch a list, filter it, add to it.
Every file is commented with *why* the code is shaped the way it is, not just
what it does.

Stack: React 19.2 + Vite 8.2. No framework, no state library, no TypeScript —
those come later, and adding them yourself is a better lesson than inheriting
them.

## Run it locally

Node 20+ required (`node -v`).

```
npm install
npm run dev          # http://localhost:5173
```

That is the whole local setup. Hot module replacement means edits appear without
a reload and without losing your form state.

Vite has no `/api` of its own, so `vite.config.js` **proxies `/api` to the
deployed Azure Function**. `App.jsx` therefore calls the same same-origin
`/api/loads` in dev as in production — no separate code path, no CORS, nothing
to install.

Two consequences worth holding onto:

- **Dev reads the production database, and refuses to write to it.** There is
  one `dbo.Loads` and your dev session is querying it. Reading it is fine.
  Writing it from a laptop is not, so the dev server answers any non-`GET`
  request to `/api` with a **403** of its own, before it leaves the machine —
  see `refuseDevWrites` in `vite.config.js`. Setting `VITE_API_TARGET` lifts
  the block, because setting it is the deliberate act of saying where writes
  should go.
- **Dev always shows you signed out.** `/.auth` is proxied too, so `/.auth/me`
  returns real JSON rather than the app shell — but the auth cookie belongs to
  the deployed origin and is never sent to `localhost`. Only production knows
  who you are. To exercise the add form for real, open a pull request and use
  the preview environment it builds.
- **Config changes need a restart.** Vite does not hot-reload `vite.config.js`.
  If `/api` suddenly returns the app shell instead of JSON, your dev server
  predates the proxy — stop it and start it again.

To point the proxy somewhere else without editing code:

```
$env:VITE_API_TARGET = 'http://localhost:7071'   # e.g. a local Functions host
npm run dev
```

### Running the API locally instead

Only needed when you are editing `api/src/functions/loads.js` itself and want
breakpoints. **This is not set up** — Azure Functions Core Tools is not
installed on this machine:

```
npm install -g @azure/functions-core-tools@4 --unsafe-perm true
Copy-Item api\local.settings.json.example api\local.settings.json   # add the password
npx swa start                                                       # http://localhost:4280
```

`swa start` runs Vite and the Functions host behind one origin on port 4280,
mirroring Azure's routing. `api/local.settings.json` holds the SQL password and
is gitignored — it must never be committed.

## Deploy

**Push to `main`.** That is the whole workflow:

```
git add -A
git commit -m "what changed"
git push
```

GitHub Actions builds the app and the API and deploys them
(`.github/workflows/azure-static-web-apps.yml`). Open a pull request instead
and you get a **preview environment on its own URL**, torn down automatically
when the PR closes — the main reason to deploy from CI rather than a laptop.

The site is hosted on **Azure Static Web Apps**, Free tier:
<https://wonderful-tree-0a929e80f.7.azurestaticapps.net>

`deploy.ps1` still works and pushes straight from your machine, bypassing git
entirely. Keep it for emergencies, but prefer pushing: a laptop deploy makes
the live site something no commit describes.

Free really is free here — no compute charge, managed HTTPS included, a custom
domain at no extra cost. The reason to pick it over dumping files in a blob
container is `/api`: Static Web Apps hosts Azure Functions next to the site for
nothing, which is the only way this app ever gets a login or a working
`AddLoadForm`. A blob container can only ever serve files.

### Setup notes, if you ever rebuild this

`.\deploy.ps1 -Provision` creates the resource group and the app. The Free SKU
exists in only a handful of regions (`eastus2` here); pick another and `create`
fails with an error that never mentions the SKU. `az login` has to be the
account that owns the subscription — **warrenjmeyer@live.com**, not the git
email. CI authenticates with the app's deployment token, stored as the repo
secret `AZURE_STATIC_WEB_APPS_API_TOKEN`; refresh it with:

```
az staticwebapp secrets list --name loadboard-wjm --resource-group loadboard-rg --query properties.apiKey -o tsv
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body <that value>
```

Use `--body`, not a pipe: piping in PowerShell appends a newline and the token
is then rejected as invalid.

## Where the load data comes from

`App.jsx` fetches **`/api/loads`**, an Azure Function living in `api/` and
deployed alongside the site. It queries `dbo.Loads` in the `Millstream` Azure
SQL database on every request, so the page shows current data, not a snapshot.

There is no CORS to configure: Static Web Apps serves the function from the
site's own origin, so `/api/loads` is same-origin by construction.

The credential never reaches the browser. It lives in the Static Web App's
application settings, which surface as environment variables inside the
Function App:

```
$env:MILLSTREAM_PASSWORD = '...'    # or the script prompts, masked
.\set-api-secrets.ps1               # push SQL_* settings into Azure
```

Run that once, and again whenever the password changes. Nothing it writes is
stored in this repo.

### Two things that will bite you

**Cold starts fail the first request.** `Millstream` is serverless
(`GP_S_Gen5_2`) and auto-pauses when idle. Waking it takes 30–60 seconds, and
Static Web Apps cuts a function request off at roughly **45 seconds** — so the
first visit after a quiet spell gets a **500**, not a slow response. The
`connectionTimeout: 120000` in `loads.js` can never be reached; the platform
gives up first.

The request that failed is what starts the wake-up, though, so `App.jsx` retries
a few times with a widening delay and says "Waking the database…" while it
waits. That turns the error into a slow first load. Everything after it is fast.

Running the same query from a script hits the other half of this: a 30s connect
timeout expires mid-resume and reports *"Connection Timeout Expired … pre-login
handshake"*, which reads like a network fault and is not one.

If the pause ever becomes genuinely annoying, it can be disabled on the
database — but a serverless database that never sleeps bills continuously, so
that is a cost decision, not a code one.

**The database firewall must allow Azure services.** The Function's outbound
IP is dynamic on the Free tier, so there is no address to allowlist; the
server carries the standard `AllowAllWindowsAzureIps` (`0.0.0.0`) rule
instead. That opens the network port to any Azure resource — every connection
still needs the `sqlmillstream` login. The properly locked-down answer is a
private endpoint, which requires the Standard SWA plan.

### Adding a load

`POST /api/loads` inserts the row and returns it. `AddLoadForm` waits for that
answer before touching the board, so what is on screen is what is in the table
— no optimistic row that might not be real.

**Every value is parameterised.** `pool.request().input('origin', sql.NVarChar(100), …)`
sends the value as data, never as SQL. Building that string by interpolation
instead is the whole of SQL injection; a destination of `x'); DROP TABLE
dbo.Loads; --` is an ordinary thing for a text input to contain.

Three things the route decides rather than accepts:

- **`status` is hard-coded** to `Available`. A load that has just been created
  is available by definition, and taking the value from the client would let a
  POST claim `Delivered` with no driver — which `CK_Loads_delivered` rejects as
  a 500 instead of an answer.
- **Validation mirrors the constraints** (`CK_Loads_miles`, `CK_Loads_rate`,
  the column widths) so a bad field comes back as a 400 naming it, not a 500
  carrying a constraint name. The table is still the backstop.
- **A duplicate id is a 409**, not an error. `IF EXISTS … THROW 50409` and
  `PK_Loads` underneath it land in the same handler, so two simultaneous posts
  of one id give one 201 and one 409 — never two rows.

### Who is allowed to add one

The board is public. Nothing else is.

**Accounts are not this app's.** A ColdFusion app at `C:\Websites\app-scaffold`
has owned `Millstream.auth` since 19 August 2026 — eighteen stored procedures,
peppered bcrypt, lockout, an audit trail. This app is a second *caller* of that
system, not a second implementation, and almost every choice in the login
follows from that.

Sign in at `?signin=1`, register at `?register=1`. Roles come from the
`auth.Users` row and are read fresh on every request:

| role | may |
|---|---|
| `none` | sign in; see the public board and nothing else |
| `driver` | their own settlement, nobody else's |
| `dispatcher` | add loads, read every settlement |
| `admin` | everything, plus approve accounts at `?view=admin` |

Registration is open and new accounts arrive at `none`, able to sign in and do
nothing until an admin approves them.

**The board stays public, but *public* means current freight only** — the 32
available and covered loads, with no driver attached. All 145 delivered rows
carry a driver code and a date, and serving those anonymously would publish who
hauled what, when and for how much.

**→ [AUTHENTICATION.md](AUTHENTICATION.md)** has the whole of it: the password
recipe and why it must match ColdFusion byte for byte, the ordering of the login
sequence and what each step defends against, sessions, the registration and
reset flow and why no password is ever emailed, the configuration, the runbook,
and the three platform behaviours that each cost an outage.

### Retrying a POST

Normally the thing you must not do — repeat it and you get two of whatever it
created. It is safe here for one reason: the load number is chosen by the
caller and is the primary key, so a second insert of the same body cannot make
a second row.

That matters because of the sleeping database. A POST that times out during a
30–60s wake-up may have written the row anyway, and the retry then meets it as
a 409. `src/lib/api.js` flags that case (`mayHaveLanded`), and `App.jsx`
re-reads the board to settle it: if the load is there, the save worked, and
saying otherwise would send someone hunting a problem that does not exist.

## The driver settlement

`?id=JSMITH` opens a company driver's pay statement; the load board is what you
get without an `id`. That mirrors the ColdFusion original this was ported from,
which was reached as `coDrvSettlement.cfm?id=<employee code>` with the check
date chosen from a dropdown. There is no router — see the comment in
`src/main.jsx` for why two pages and one query parameter do not need one.


### Pages

```
/                      the load board
?view=settlements      every settlement, filterable
?id=JSMITH             one driver's pay statement
?id=JSMITH&date=...    ...at a specific check date
```

The settlements board is built to the same pattern as the load board on
purpose: a container owning data and filters, a controlled filter component
with no state of its own, a table, a row. If you can read one you can read the
other, and that is worth more than any cleverness that would make them differ.

It replaced a list of every driver at the bottom of the load board. That was
fine at two drivers and unreadable at twenty — a board filters, a wall of names
cannot.
Drivers are the two Drive Users from the Millstream GeoTab account (James Smith
`JSMITH`, Sherman Oaks `SOAKS`). Their names and the company address are real;
every dollar figure is invented.

### What the statement computes

The bottom line is a plain sum, because deductions are **stored negative**:

```
settlementTotal = routePay + revenue + perDiem + reimbursements + deductions
```

It is called **settlement total**, not net pay, and the distinction matters.
Nothing here withholds tax: the original took net pay from UKG, which knew the
driver's W-4, filing status and YTD wages. This figure is what the settlement
itself can account for — earnings less the deductions it knows about — and for a
W-2 driver it sits 20–25% above what actually reaches their bank account. A
document whose whole job is being trusted should not label that "net pay".

The original negated amounts at query time in three different places, and
negated reimbursements too — which looks like an accident of the source data
rather than intent. Putting the sign in the column means nothing downstream has
to remember which way to flip a number, and `CK_Lines_deduction_sign` stops a
positive deduction being inserted at all.

Rate per mile is `payAmount / totalMiles`. A line with no miles — a layover, a
breakdown — has no rate to divide out. The original printed the flat dollar
amount in the rate column, so $150 of layover pay displayed as a rate of "150";
this shows an em dash instead.

### The load a trip was

`dbo.SettlementRoutes.load_id` is a foreign key to `dbo.Loads`. Every paid trip
points at the freight it was; every delivered load names the driver who ran it
and the date. Before this they were unrelated text columns, so the board
advertised loads nobody was paid for and drivers were paid for trips that never
existed as loads — which for a document whose job is being checkable was the
wrong shape.

`load_id` is nullable for exactly one reason: a `SPECIAL` line is real pay for
no freight — breakdown, layover, a guarantee top-up. Those must not be forced
to invent a load to point at.

`CK_Loads_delivered` requires a Delivered load to have both a driver and a
date, and a non-delivered load to have neither. A delivery date with nobody
attached is the sort of half-state this whole change exists to prevent.

The carrier's rate on a load is **not** the driver's pay. A load paying the
driver $0.62/mi bills the customer around $2.90/mi; equal figures would be the
tell that the data is invented.

### Tables

Created by `settlement_01_ddl.sql`, seeded by `settlement_02_data.sql`:

| Table | Came from | Holds |
|---|---|---|
| `dbo.Drivers` | `EMPLOYEE_MASTER` | name, address, pay rate, pay group |
| `dbo.Settlements` | one row per check | the pay period and document number |
| `dbo.SettlementRoutes` | `COMPANY_ROUTE` | earnings by load: miles and pay |
| `dbo.SettlementLines` | `CODRIVERS_REVENUE` + `_DEDUCTIONS` + `_REIMBURSMENTS` | every adjustment, with a type |

Three source tables collapse into `SettlementLines` because the original
immediately UNIONed them back together and then filtered by type. One table
with a discriminator says the same thing without the union.

`SettlementRoutes.pay_rate` is stored rather than read from the driver: a
settlement is a historical record, and re-rating a driver must not silently
rewrite what they were paid last March. For the same reason the total is *not* a
column — it is computed, so a stored total can never disagree with its own
detail.

### Two kinds of driver, one route

`settlement_06_owner.sql` adds owner/operators — 1099 contractors who own the
truck. The original had two ColdFusion pages (`coDrvSettlement.cfm` and
`ownDrvSettlement.cfm`) reading two sets of DB2 tables, `CODRIVERS_*` and
`OWNER_OPERATOR_*`, which held the same columns under different names. Here it
is **one set of tables and one URL**: `dbo.Drivers.driver_type` is `COMPANY` or
`OWNER`, and `/settlements/:driverCode` renders whichever document the driver's
type calls for. A driver following a link to their own statement never has to
know which kind of contract they are on, and reclassifying someone in the
database changes their statement without breaking a single existing link.

What the owner/operator statement adds:

| | Why |
|---|---|
| Every figure weekly **and** year-to-date | A contractor is running a business; one week in isolation says nothing about whether it works |
| `dbo.SettlementEscrow` | Maintenance and tire funds the carrier holds on their behalf — no company-driver equivalent |
| `Drivers.pay_basis` | `MILEAGE` or `PERCENTAGE`. It is what makes `pay_rate` readable: `0.68` is 68% of the linehaul on one contract and 68¢ a mile on the other |
| `SettlementRoutes.linehaul_revenue` | What the load billed. A percentage driver's pay is a share of it, so without it their pay is unverifiable |

`CK_Escrow_chain` enforces `current_balance = beginning_balance +
transaction_amount`. The original printed those three as independent columns,
so a bad feed could show an ending balance that did not follow from the change
above it. That row now cannot be written.

Two things in the original were deliberately **not** ported. It derived a
percentage-vs-mileage flag by sniffing for `REVENUE_CODE = '15'`, and used it
only to decide whether deduction code `66` or `61` got a `'FUEL-'` prefix —
a workaround for their data, replaced here by an explicit `pay_basis`. And its
escrow block hid any row whose beginning or current balance was zero, which
silently dropped a newly opened account; those rows are shown.

The settlement total is **not** net pay on either statement, but for different
reasons — a company driver still has tax to come out via payroll, while an
owner/operator is paid in full and owes quarterly estimated tax on it. Each
page says its own version, because a number this consequential should not have
to be interpreted.

### More test drivers

`geotab-add-drivers.ps1` adds drivers to a MyGeotab database over the API:

```
$env:GEOTAB_DATABASE = 'demo_millstream'
$env:GEOTAB_USER     = 'warrenjmeyer@live.com'
.\geotab-add-drivers.ps1 -Count 10 -WhatIf   # preview
.\geotab-add-drivers.ps1 -Count 10           # create
```

The MyGeotab database is **`demo_millstream`**, not `Millstream` — that is the
company name, and also the Azure SQL database, which makes the two easy to
confuse. Authenticating against the wrong one reports "Incorrect login
credentials", which reads like a bad password and is not; the script retries
without a database name and tells you the one Geotab resolves.

The MyGeotab password is its own credential too. Same email as the Azure
sign-in, different password.

All drivers can share one password, which is convenient for testing the Drive
app. Pass it rather than editing the script — a password written into a file is
a password in every clone and in the whole git history:

```
.\geotab-add-drivers.ps1 -Database demo_millstream -SetPasswordForAll -DriverPassword '...'
$env:GEOTAB_DRIVER_PASSWORD = '...'    # or set it once and omit the flag
```

Without one, created drivers get a generated password printed at the end.

Drivers are created with `hosRuleSet` `America8Day` — USA Property
70-hour/8-day. `-ApplyHosRuleSetToAll` sets it on drivers that already exist:

```
.\geotab-add-drivers.ps1 -Database demo_millstream -ApplyHosRuleSetToAll -WhatIf
```

It skips users that already exist, so re-running is safe, and prints a
`DriverCode` per driver in the form `dbo.Drivers` uses. `-ListGroups` prints the
group ids if an `Add` is rejected for an unknown group.

Two things the script handles that trip people up. Authentication returns the
server your database actually lives on (`result.path`); calls made to the
federation host after that fail. And Geotab answers with HTTP 200 even when a
call was rejected — the failure is an `error` object in the body, so checking
the status code alone treats every rejection as success.

These are real users who can sign in to the Drive app. Point it at a test
database.

### Vehicles

A driver is not a field on a vehicle in Geotab. The association is a
**`DriverChange`** record — "this driver is in this vehicle from this moment" —
which is what the Drive app and the HOS logs key off. It is unrelated to
`driverGroups` and `Device.groups`, which control who can *see* what.

```
.\geotab-assign-vehicles.ps1 -Database demo_millstream -ListDevices
.\geotab-assign-vehicles.ps1 -Database demo_millstream -WhatIf
.\geotab-assign-vehicles.ps1 -Database demo_millstream
```

Pairing is by position after sorting both lists by name, so re-running pairs
the same people with the same trucks. Surplus vehicles are left unassigned. The
resulting pairing is written to `driver-vehicles.json`, which is what the
settlement `unit_no` values can be updated from.

### Zones

GeoTab has no notion of an origin and a destination on a load. It has **zones**
— named polygons — and **routes**, whose stops are references to zones.

```
.\geotab-add-zones.ps1 -Database demo_millstream -CheckTelematics
.\geotab-add-zones.ps1 -Database demo_millstream -WhatIf
.\geotab-add-zones.ps1 -Database demo_millstream
```

Zones are derived from **where the fleet actually stops**: recent trips are
read, their stop points clustered, and the busiest places become zones. A zone
is only worth having somewhere a truck goes.

That matters here because of a mismatch worth knowing about. The settlement
lanes are Midwest — Dubuque, Chicago, Kansas City — matching the real Millstream
address. The demo vehicles are a live simulated feed that drives around **Las
Vegas**. Zones placed on the settlement cities would be correct configuration
that no vehicle ever enters. `-FromLanes` still builds those 18 city zones if
you want them; the default follows the trucks instead.

`-CheckTelematics` reports each vehicle's last known position, which is how
that was established in the first place. Worth running before assuming a fleet
does or does not move — I assumed wrong.

Two geometry details. Geotab points are `x = longitude, y = latitude`, and
swapping them puts Iowa in the Indian Ocean. And the box around each centre
divides its longitude span by `cos(latitude)`, without which a zone in
Minneapolis comes out wider than one in Dallas for the same stated radius.

### Routes

A route is an ordered list of stops, each a reference to a zone — so the zones
have to exist first. One route per lane in the settlement data:

```
.\geotab-add-zones.ps1  -Database demo_millstream -FromLanes
.\geotab-add-routes.ps1 -Database demo_millstream -WhatIf
.\geotab-add-routes.ps1 -Database demo_millstream
```

The lanes are **read from the settlement SQL**, not duplicated in the script.
They come from the settlements AND the load board: reading only the
settlements is exactly how the routes came to cover 7 of the load board's 32
lanes. Currently 47 lanes across 19 cities.

Every city is resolved to a zone before anything is created. Creating half the
routes and then failing on a missing zone leaves a state nobody asked for, so
a missing zone is an error up front with the command that fixes it.

These routes describe the lane network the pay statements are built on. They
will not produce adherence data, because the vehicles in this database drive
around Las Vegas and will never enter a Midwest zone — that is a known
mismatch, not a fault.

If an `Add` is rejected for a property you cannot place, make one route by hand
in MyGeotab (Zones & Messages > Routes > Add) and then read its shape back:

```
.\geotab-add-routes.ps1 -Database demo_millstream -ShowSchema
```

That prints the route exactly as Geotab returns it, plus one stop on its own.

The one field that genuinely has to be right is the stops property: it is
`routePlanItemCollection`, not the `routePlanItems` the SDK docs suggest.
Everything else on a Route is defaulted by Geotab, so a route read back looks
considerably fuller than the payload that created it — worth knowing before
mistaking a default for a requirement, which is a mistake this project made.

```
GET /api/settlements                                   # every settlement, with totals
GET /api/drivers                                       # drivers who have settlements
GET /api/drivers/{driverCode}/settlements              # check dates, newest first
GET /api/drivers/{driverCode}/settlements/{checkDate}  # one full statement
```

They bind their parameters. The original interpolated `#url.id#` straight into
the SQL string, which made the driver code executable.

## VS Code extensions worth having

- **ESLint** — catches the hook mistakes (missing deps, conditional hooks)
  before they become confusing bugs
- **Prettier** — stop thinking about formatting
- **Error Lens** — puts errors inline instead of in the Problems panel

## Where the pieces live

```
index.html              the empty shell React mounts into
src/main.jsx            entry point — the <Routes> table, and the token pre-read
src/App.jsx             owns the data + filter state, wires everything together
src/components/
  LoadFilters.jsx       controlled inputs, no state of its own
  LoadTable.jsx         renders a list, handles the empty case
  LoadRow.jsx           pure presentation
  AddLoadForm.jsx       owns local form state, posts it, reports up
AUTHENTICATION.md       how signing in works, and why it is shaped that way
public/staticwebapp.config.json   routing and SPA fallback
api/src/functions/loads.js        GET and POST /api/loads, against dbo.Loads
api/package.json        the Function App's own dependencies (mssql)
.github/workflows/      builds and deploys on push to main
vite.config.js          dev server config — proxies /api, refuses dev writes
swa-cli.config.json     for `swa start`; unused until Core Tools is installed
loads_01_ddl.sql        how dbo.Loads is defined — columns and constraints
loads_02_data.sql       its original 8 rows; re-runnable (MERGE, not INSERT)
settlement_01_ddl.sql   Drivers / Settlements / Routes / Lines
settlement_02_data.sql  sample settlements for the two GeoTab drivers
settlement_03_fleet.sql the ten GeoTab drivers, two weeks of settlements each
settlement_04_fleet2.sql eight more, bringing the fleet to twenty
settlement_05_link.sql  ties SettlementRoutes.load_id to dbo.Loads
settlement_06_owner.sql owner/operators: driver_type, escrow, four contractors
tools/gen_owner_settlements.mjs   generates the file above — edit this, not it
geotab-add-drivers.ps1  creates test drivers in MyGeotab (see below)
geotab-add-vehicles.ps1 adds vehicles as untracked assets -- no hardware needed
geotab-assign-vehicles.ps1  pairs each driver with a vehicle (DriverChange)
geotab-add-zones.ps1    geofences for the 18 cities the lanes touch
geotab-add-routes.ps1   one route per settlement lane, origin -> destination
geotab-common.ps1       shared MyGeotab auth and transport
src/pages/Settlement.jsx          the statement shell — the router worked example
src/components/settlement/        both statements, and the blocks they share
src/lib/api.js          fetchJson / postJson / fetchUser — and the cold-start retry
src/lib/format.js       money, miles and date formatting in one place
```

## Exercises, roughly in order

Each one forces you to confront a specific React idea. Do them in order; they
build on each other.

1. **Sortable columns.** Click a header to sort by that column, click again to
   reverse. *Teaches:* derived state again — sort order is two state values
   (`sortKey`, `sortDir`), and the sorted array is computed, never stored.
   Watch out: `Array.sort()` mutates. You need `[...loads].sort()`.

2. **Delete a load.** Add an X button per row. *Teaches:* passing a callback
   down two levels, and why `key` has to be the load id and not the array
   index — delete a middle row with index keys and watch React put the wrong
   data in the wrong row.

3. **Edit a load inline.** Click a row to make it editable, save or cancel.
   *Teaches:* the hardest thing in this list — where does the draft live while
   you're editing? (Local to the row. The parent only hears about the save.)

4. **Persist to localStorage.** Loads survive a page refresh. *Teaches:*
   `useEffect` with a dependency array that isn't `[]`, and the ordering
   problem of reading saved state before the fetch overwrites it.

5. **Extract a custom hook.** Pull the fetch logic out of `App.jsx` into
   `useLoads()` in its own file. *Teaches:* what hooks actually are — plain
   functions that call other hooks. This is the thing that makes React click
   for most people.

6. **Add routing.** *Partly done — scaffolded, the rest is yours.*

   `npm i react-router-dom` first; nothing runs until you do.

   Already converted, as the worked example: `main.jsx` is a `<Routes>` table,
   and the settlement moved from `?id=JSMITH&date=...` to
   `/settlements/JSMITH?date=...`. Read `src/pages/Settlement.jsx` top to
   bottom — it is commented as the reference for the pattern.

   The split it teaches: **the path identifies the resource** (`:driverCode`,
   read with `useParams`), **the query string is a view setting on it**
   (`?date=`, read with `useSearchParams`). Get that boundary right and the
   back button works for free; get it wrong and you have two sources of truth
   for the same value.

   Also done: `base: './'` → `'/'` in `vite.config.js`. A deep link like
   `/settlements/JSMITH` resolves `./assets/...` against `/settlements/` and
   404s, and because `public/staticwebapp.config.json` has a
   `navigationFallback`, what comes back is `index.html` with a 200 — a blank
   page whose only clue is a MIME-type warning.

   **Still yours to do** (every spot is marked `TODO (yours)`):

   - Swap the remaining `<a href="?...">` for `<Link to="...">` in `App.jsx`,
     `AccessNotice.jsx`, `AddLoadForm.jsx`, `SignIn.jsx`, `Register.jsx` and
     `Admin.jsx`. Do `App.jsx` first and watch the network tab: `/api/me`
     stops being re-requested on every page move.
   - `VerifyEmail.jsx` and `SetPassword.jsx` are the exception. They render
     *outside* the router (see the comment at the top of `main.jsx`) because
     the token has to be scrubbed from the URL before `BrowserRouter` snapshots
     it. `<Link>` throws there. Only their `href` targets need updating.
   - Decide whether the load board's search belongs in the URL. Making it a
     search param makes a filtered board linkable; doing it naively on every
     keystroke is worse than not doing it.
   - Then the original exercise: give each load its own URL at
     `/loads/L-10412`, which needs a detail page that does not exist yet.

   Why the token pages keep `/?verify=TOKEN` rather than becoming
   `/verify/:token`: a path parameter is *more* exposed, not less. Both sit in
   history, but only a query string can be rewritten away without navigating.
   It also means no already-sent email breaks — the links in
   `api/src/functions/register.js` are unchanged.

7. ~~**Swap the JSON for a real API.**~~ **Done** — see "Where the load data
   comes from" above. `App.jsx` now fetches `/api/loads`, served by an Azure
   Function in `api/`. What it taught, if you want to trace it: the browser
   never holds a credential, loading and error states suddenly matter because
   a cold database really does take 30+ seconds, and there is no CORS to fight
   because the API is served from the site's own origin.

## For interviews

The questions that come up constantly for a mid/senior React role, all of
which this project touches:

- Why does state have to be immutable? (Reference comparison — see the comment
  in `App.jsx` above `handleAddLoad`.)
- What is `key` for and why not the index?
- When does `useEffect` run, and what's the dependency array doing?
- Controlled vs uncontrolled inputs.
- What causes a re-render? (A state change in a component re-renders that
  component and everything below it. Not "when data changes.")
- Why is derived state usually better than stored state?

If you can answer those from the code you wrote rather than from a blog post,
you're in reasonable shape.
