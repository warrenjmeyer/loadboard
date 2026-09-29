import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { MODULES as PLANNER, SUPPORT_FILES as PLANNER_SUPPORT } from './get-me-home/modules.ts'
import { MODULES as SCHEDULE, SUPPORT_FILES as SCHEDULE_SUPPORT } from './home-time-schedule/modules.ts'
import type { ModuleInfo } from './get-me-home/modules.ts'

// ---------------------------------------------------------------------------
// THE STANDING REQUIREMENT, CHECKED: every addition under src/features is a
// reusable module. (CLAUDE.md and src/features/README.md say it in words;
// this says it in a way that fails.)
//
// For every feature folder:
//   - every component file (.tsx) in it is a registered module, the piece of
//     one, or a declared support file -- so a new screen cannot be added
//     without being registered;
//   - every module and piece is exported from the folder's index.ts;
//   - every read a module declares is a method of the folder's adapter, and
//     the wrapper really makes it -- directly, or through a module it mounts;
//   - pieces fetch nothing: no adapter anywhere in a piece's file;
//   - every module has a live demo on the modules page.
//
// Read as text, because a .tsx file cannot be imported under plain Node.
// A NEW FEATURE FOLDER GOES IN THE LIST BELOW on the day it is created.
// ---------------------------------------------------------------------------
const FEATURES: { folder: string; modules: readonly ModuleInfo[]; support: readonly string[]; adapter: string }[] = [
  { folder: 'get-me-home', modules: PLANNER, support: PLANNER_SUPPORT, adapter: 'Adapter' },
  { folder: 'home-time-schedule', modules: SCHEDULE, support: SCHEDULE_SUPPORT, adapter: 'ScheduleAdapter' },
]

const here = (path: string) => new URL(path, import.meta.url)
const text = (path: string) => readFileSync(here(path), 'utf8')

// The code without its comments. A piece's comment may well explain that it
// has no adapter -- that is prose, not a fetch. (The `[^:]` keeps "https://"
// in a string from being read as a comment.)
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const modulesPage = text('./preview/ModulesPage.tsx')

// One `const NAME: ... = { ... }` object literal out of a file, so a key is
// looked for in the map it belongs to and not anywhere on the page.
function block(src: string, opening: string): string {
  const start = src.indexOf(opening)
  assert.ok(start >= 0, `preview/ModulesPage.tsx has no ${opening}`)
  return src.slice(start, src.indexOf('\n}', start))
}

// The adapter interface's body, so a read is looked for there and nowhere else.
function adapterBody(folder: string, name: string): string {
  const src = text(`./${folder}/contract.ts`)
  const start = src.indexOf(`export interface ${name} {`)
  assert.ok(start >= 0, `${folder}/contract.ts has no interface ${name}`)
  return src.slice(start, src.indexOf('\n}', start))
}

test('every feature folder under src/features is in the list above', () => {
  const folders = readdirSync(here('./'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'preview')
    .map((d) => d.name)
    .sort()
  assert.deepEqual(folders, FEATURES.map((f) => f.folder).sort(), 'a new feature folder must be registered here, with its modules.ts')
})

for (const f of FEATURES) {
  test(`${f.folder}: every component file is a module, a piece, or declared support`, () => {
    const registered = new Set([
      ...f.modules.flatMap((m) => [m.file, m.pieceFile].filter((x): x is string => x !== null)),
      ...f.support,
    ])
    const components = readdirSync(here(`./${f.folder}/`)).filter((n) => n.endsWith('.tsx'))
    const loose = components.filter((c) => !registered.has(c))
    assert.deepEqual(loose, [], `not registered in ${f.folder}/modules.ts -- make each a module (a piece and its loading wrapper), or say why it is support`)
    for (const r of registered) assert.ok(existsSync(here(`./${f.folder}/${r}`)), `${f.folder}/modules.ts names ${r}, which does not exist`)
  })

  test(`${f.folder}: every module and piece is exported`, () => {
    const index = text(`./${f.folder}/index.ts`)
    for (const m of f.modules) {
      for (const name of [m.name, m.piece].filter((x): x is string => x !== null)) {
        assert.match(index, new RegExp(`default as ${name}\\b`), `${f.folder}/index.ts does not export ${name}`)
      }
    }
  })

  test(`${f.folder}: each module makes exactly the scoped reads it declares`, () => {
    const body = adapterBody(f.folder, f.adapter)
    for (const m of f.modules) {
      const src = text(`./${f.folder}/${m.file}`)
      for (const read of m.reads) {
        assert.match(body, new RegExp(`\\b${read}\\(`), `${m.name} declares ${read}, which ${f.adapter} does not have`)
        // Directly, or by mounting a module that does.
        const via = f.modules.filter((o) => o !== m && o.reads.includes(read)).some((o) => src.includes(`<${o.name}`))
        assert.ok(src.includes(`adapter.${read}(`) || via, `${m.name} declares ${read} but never makes it`)
      }
      if (m.reads.length === 0) assert.ok(!/\badapter\b/.test(code(src)), `${m.name} reads nothing, so it should not touch an adapter`)
      // And NO MORE than it declares: a module that quietly makes a wider
      // read -- the driver's screen calling loadBoard, say -- receives data
      // its screen has no business holding.
      for (const [, read] of code(src).matchAll(/adapter\.(load\w+)\(/g)) {
        assert.ok(m.reads.includes(read!), `${m.name} makes ${read}, which it does not declare -- a wider read than its screen needs`)
      }
    }
  })

  test(`${f.folder}: pieces fetch nothing`, () => {
    for (const m of f.modules) {
      if (!m.pieceFile) continue
      assert.ok(!/\badapter\b/.test(code(text(`./${f.folder}/${m.pieceFile}`))), `${m.piece} is a piece: it must draw from props, not reach for an adapter`)
    }
  })

  test(`${f.folder}: every module has a demo, and every piece a demo of its own`, () => {
    const modules = block(modulesPage, 'const DEMOS')
    const pieces = block(modulesPage, 'const PIECE_DEMOS')
    for (const m of f.modules) {
      assert.match(modules, new RegExp(`^\\s+${m.name}: \\(\\) =>`, 'm'), `no demo for ${m.name} in DEMOS in preview/ModulesPage.tsx`)
      // The piece alone, from plain data, with no adapter and no tab around
      // it. A piece that only works inside its tab is not reusable yet.
      if (m.piece) assert.match(pieces, new RegExp(`^\\s+${m.piece}: \\(\\) =>`, 'm'), `no piece demo for ${m.piece} in PIECE_DEMOS in preview/ModulesPage.tsx`)
    }
  })
}
