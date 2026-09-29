# loadboard

A React (JavaScript) load board on Azure Static Web Apps, with an Azure
Functions API in `api/`. `README.md` is the full guide. Under `src/features/`
is separate, TypeScript work for another app, MyTechgacity -- the tabs of its
component page, designed here and ported there by a remote developer who
cannot see this repo.

## Standing requirement: every addition is a reusable module

Applies to everything under `src/features/`: the Get Me Home Planner, the
Driver Home Time Schedule, the Driver Load Plans tab still to come, and
anything after. Set by Warren on 2026-09-29. Follow it from the first commit
of new work -- do not build a screen and modularise it later.

A module is two things, both exported:

1. **A piece** -- a presentational component. Props in, JSX out. It fetches
   nothing and never touches an adapter.
2. **Its loading wrapper** -- takes the adapter plus the scope it needs (a
   driver code, a stay id, a date window), reads **only** what that screen
   shows through a **scoped adapter read**, handles loading, errors and
   refresh, and renders the piece. Never "load everything and filter": each
   read answers with its slice and no more (size, and privacy -- a driver's
   screen must not receive other drivers' data).

   A piece that shows no data (e.g. `StatusChip`) is its own module and
   needs no wrapper.

   **Every read says WHO may call it** (in the adapter interface's doc
   comments), and the server enforces that from the signed-in user. Scoping
   keeps a screen from *receiving* data it does not show; only the server
   keeps a hand-written request from *getting* it. A driver's reads carry
   their own stays and nobody else's -- ever.

Every module is:

- exported from its feature's `index.ts` -- the piece, the wrapper, their
  prop types;
- registered in the feature's `modules.ts` (name, file, piece, the reads it
  makes, a summary, a usage line);
- given two live demos on the modules page, `src/features/preview/ModulesPage.tsx`
  (`/get-me-home.html?page=modules` on `npm run dev`): the module loading
  through a sample adapter, and **its piece alone**, from plain data with no
  adapter and no tab around it -- a piece that only works inside its tab is
  not reusable yet;
- covered: pure rules under `node --test`, pieces in `src/render.check.mjs`.

**`src/features/modules.test.ts` enforces this** and runs in `npm test`: a
`.tsx` file that is not a registered module, piece or declared support file
fails; so does an unexported module, a declared read the adapter lacks or
the wrapper never makes, a wrapper making a read it does NOT declare (a
wider read than its screen needs), a piece that references an adapter, and a
module or piece with no demo.

**A new tab is a new folder under `src/features/`**, built this way from the
start: `contract.ts` (types, and an adapter whose reads are scoped per
screen), pure rules with tests, fixtures, pieces, wrappers, `modules.ts`,
demos -- and a line for the folder in `modules.test.ts`'s `FEATURES`.

## The rest of the src/features rules

`src/features/README.md` has them in full. In short: TypeScript
(`npm run typecheck`); each feature folder moves to the host by copying, so no
imports between feature folders or into the load board's `.js`/`.jsx` (the
preview is where features meet); imports spell out `.ts`/`.tsx`; erasable
syntax only, so pure files run under plain `node --test`; MUI styled through
`sx` with palette names, never hex; the preview is dev-only and never built.
