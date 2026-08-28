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
npm run dev          # UI only, http://localhost:5173
```

Hot module replacement means edits appear without a reload and without losing
your form state. But `npm run dev` serves **only** the front end — `/api/loads`
404s, so the load table will show an error. To run the API too:

```
npm install -g @azure/functions-core-tools@4 --unsafe-perm true   # one time
cp api/local.settings.json.example api/local.settings.json        # then add the password
npx swa start                                                     # http://localhost:4280
```

`swa start` runs the Vite dev server and the Functions host together behind one
origin on port **4280**, which is the arrangement Azure actually serves. Use
4280, not 5173, whenever you are touching the API. `api/local.settings.json`
holds the SQL password and is gitignored — it must never be committed.

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

**Cold starts are real.** `Millstream` is serverless (`GP_S_Gen5_2`) and
auto-pauses when idle. The first request after a pause does not fail — it
triggers a resume that takes 30–60 seconds, during which the client sits in
the pre-login handshake. `loads.js` allows 120s for this. A 30s timeout expires
mid-resume and reports a "pre-login handshake" error that reads like a network
fault and is not one.

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
swa-cli.config.json     lets `swa start` run the UI and API together locally
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
