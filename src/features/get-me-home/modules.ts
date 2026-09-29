// ---------------------------------------------------------------------------
// THE PLANNER'S MODULES -- everything a host can mount on its own.
//
// A module is a PIECE (a presentational component: props in, nothing
// fetched) and the LOADING WRAPPER around it (reads exactly what that
// screen shows through a scoped adapter read, handles loading, errors and
// refresh, renders the piece). A piece that shows no data is its own module
// and needs no wrapper.
//
// This list is the register. The modules page draws a live demo of each
// entry; src/features/modules.test.ts fails if a component file here is not
// in it, or an entry is not exported from index.ts. So a new screen is a new
// entry, or the tests say so. See src/features/README.md.
//
// Plain data -- no imports -- so plain Node can read it in that test.
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
    name: 'GetMeHomePlanner',
    file: 'GetMeHomePlanner.tsx',
    piece: 'PlannerView',
    pieceFile: 'PlannerView.tsx',
    reads: ['loadRoster'],
    summary: 'The whole tab: every driver most urgent first, and the chosen driver\'s trip home beside them.',
    usage: '<GetMeHomePlanner adapter={adapter} organizationId={org} />',
  },
  {
    name: 'PlannerRoster',
    file: 'PlannerRoster.tsx',
    piece: 'RosterTable',
    pieceFile: 'RosterTable.tsx',
    reads: ['loadRoster'],
    summary: 'The roster table on its own, for a host that shows the picked driver somewhere else.',
    usage: '<PlannerRoster adapter={adapter} onSelect={(driverCode) => openDriver(driverCode)} />',
  },
  {
    name: 'DriverTripHome',
    file: 'DriverTripHome.tsx',
    piece: 'DriverPlan',
    pieceFile: 'DriverPlan.tsx',
    reads: ['loadDriver'],
    summary: 'One driver\'s trip home -- every drive, break and rest -- reading that driver alone.',
    usage: '<DriverTripHome adapter={adapter} driverCode="TBOONE" />',
  },
  {
    name: 'StatusChip',
    file: 'StatusChip.tsx',
    piece: null,
    pieceFile: null,
    reads: [],
    summary: 'A status as a chip, or a count of them. Shows no data of its own, so it needs no wrapper.',
    usage: '<StatusChip status="TIGHT" />   <StatusChip status="LATE" count={2} />',
  },
]

/** Component files that are not screens: providers and the like. None here. */
export const SUPPORT_FILES: readonly string[] = []
