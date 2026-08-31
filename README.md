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

- **Dev reads the production database.** There is one `dbo.Loads` and your dev
  session is querying it. That is fine while the API is read-only, which it is
  today. Revisit it before you add a POST route, or you will be writing to live
  data from your laptop.
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

### Writes still do not persist

`AddLoadForm` adds rows to React state in the browser only; there is no POST
handler yet, so a refresh loses them. The shape to copy is already in
`loads.js` — add an `app.http` route with `methods: ['POST']`, take the pool
the same way, and use a parameterised `pool.request().input(...)` query.
**Never** interpolate values into the SQL string. That route is also where the
`auth` schema in `Millstream` finally earns its keep, because at that point
you need to know who is adding the load.
## The driver settlement

`?id=JSMITH` opens a company driver's pay statement; the load board is what you
get without an `id`. That mirrors the ColdFusion original this was ported from,
which was reached as `coDrvSettlement.cfm?id=<employee code>` with the check
date chosen from a dropdown. There is no router — see the comment in
`src/main.jsx` for why two pages and one query parameter do not need one.

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

### Endpoints

```
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
src/main.jsx            entry point — connects React to the DOM
src/App.jsx             owns the data + filter state, wires everything together
src/components/
  LoadFilters.jsx       controlled inputs, no state of its own
  LoadTable.jsx         renders a list, handles the empty case
  LoadRow.jsx           pure presentation
  AddLoadForm.jsx       owns local form state, reports up via callback
public/staticwebapp.config.json   routing, SPA fallback, /api passthrough
api/src/functions/loads.js        GET /api/loads — reads dbo.Loads live
api/package.json        the Function App's own dependencies (mssql)
.github/workflows/      builds and deploys on push to main
vite.config.js          dev server config — proxies /api to the deployed app
swa-cli.config.json     for `swa start`; unused until Core Tools is installed
loads_01_ddl.sql        how dbo.Loads is defined — columns and constraints
loads_02_data.sql       its original 8 rows; re-runnable (MERGE, not INSERT)
settlement_01_ddl.sql   Drivers / Settlements / Routes / Lines
settlement_02_data.sql  sample settlements for the two GeoTab drivers
settlement_03_fleet.sql the ten GeoTab drivers, two weeks of settlements each
settlement_04_fleet2.sql eight more, bringing the fleet to twenty
geotab-add-drivers.ps1  creates test drivers in MyGeotab (see below)
geotab-assign-vehicles.ps1  pairs each driver with a vehicle (DriverChange)
geotab-add-zones.ps1    geofences for the 18 cities the lanes touch
geotab-common.ps1       shared MyGeotab auth and transport
src/pages/Settlement.jsx          the pay statement
src/components/settlement/        its load table and adjustment blocks
src/lib/api.js          fetchJson — the retry that survives a cold database
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

6. **Add routing.** `npm i react-router-dom`, give each load its own URL at
   `/loads/L-10412`. *Teaches:* client-side routing, and why
   `public/staticwebapp.config.json` sets `navigationFallback` to
   `/index.html` — a deep link isn't a real file, so Static Web Apps has to
   serve the app and let the router sort it out. Note: this is also the moment
   `base: './'` in `vite.config.js` has to become `'/'`, or the assets a deep
   link pulls in resolve relative to `/loads/` and 404.

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
