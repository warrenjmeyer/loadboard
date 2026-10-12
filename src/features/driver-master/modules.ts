// ---------------------------------------------------------------------------
// THE DRIVER MASTER'S MODULES -- everything a host can mount on its own.
//
// A module is a PIECE (a presentational component: props in, nothing
// fetched) and the LOADING WRAPPER around it (reads exactly what that
// screen shows through a scoped adapter read -- see scope.ts -- handles
// loading, errors and refresh, renders the piece).
//
// This list is the register. The modules page draws a live demo of each
// entry; src/features/modules.test.ts fails if a component file here is not
// in it, or an entry is not exported from index.ts. See src/features/README.md.
//
// The same shape as the other tabs' modules.ts, written again rather than
// shared, so each folder still moves on its own. Plain data, no imports.
// ---------------------------------------------------------------------------
export interface ModuleInfo {
  /** What a host mounts. */
  name: string
  file: string
  /** The presentational component inside it; null when the module is itself the piece. */
  piece: string | null
  pieceFile: string | null
  /** The adapter reads it makes, scoped to this screen. Empty when it loads nothing. */
  reads: readonly string[]
  summary: string
  /** How a host mounts it. */
  usage: string
}

export const MODULES: readonly ModuleInfo[] = [
  {
    name: 'DriverMaster',
    file: 'DriverMaster.tsx',
    piece: 'DriverMasterView',
    pieceFile: 'DriverMasterView.tsx',
    reads: ['loadDriverList', 'loadDriver'],
    summary: 'The whole tab: DriverDirectory, and DriverEditor in a dialog over it, in one DriverSync so a save redraws the list.',
    usage: '<DriverMaster adapter={adapter} organizationId={org} />',
  },
  {
    name: 'DriverDirectory',
    file: 'DriverDirectory.tsx',
    piece: 'DriverTable',
    pieceFile: 'DriverTable.tsx',
    reads: ['loadDriverList'],
    summary: 'Every driver, a line each, to search and open -- no address, SSN or pay. Add driver for an admin.',
    usage: '<DriverDirectory adapter={adapter} onOpen={(code) => open(code)} onAdd={() => add()} />',
  },
  {
    name: 'DriverEditor',
    file: 'DriverEditor.tsx',
    piece: 'DriverForm',
    pieceFile: 'DriverForm.tsx',
    reads: ['loadDriver'],
    summary: 'One driver to read and change, or a new one to add. Pay appears only when the server sends it: to an admin.',
    usage: '<DriverEditor adapter={adapter} driverCode="TBOONE" onClose={close} />   <DriverEditor adapter={adapter} driverCode={null} />',
  },
]

/** Component files that are not screens. sync.tsx is the DriverSync provider. */
export const SUPPORT_FILES: readonly string[] = ['sync.tsx']
