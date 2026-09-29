// ---------------------------------------------------------------------------
// THE LOAD PLANS' MODULES -- everything a host can mount on its own.
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
    name: 'DriverLoadPlans',
    file: 'DriverLoadPlans.tsx',
    piece: 'LoadPlansView',
    pieceFile: 'LoadPlansView.tsx',
    reads: ['loadOpenLoads', 'loadPlanBoard'],
    summary: 'The whole dispatch tab: OpenLoads above LoadPlanBoard, in one PlanSync so an assignment redraws the week.',
    usage: '<DriverLoadPlans adapter={adapter} organizationId={org} drive={driveFor} />',
  },
  {
    name: 'OpenLoads',
    file: 'OpenLoads.tsx',
    piece: 'OpenLoadList',
    pieceFile: 'OpenLoadList.tsx',
    reads: ['loadOpenLoads'],
    summary: 'Loads with no driver, picking up this week, soonest first -- each with "Find a driver".',
    usage: '<OpenLoads adapter={adapter} drive={driveFor} />',
  },
  {
    name: 'SuggestDriver',
    file: 'SuggestDriver.tsx',
    piece: 'CandidateList',
    pieceFile: 'CandidateList.tsx',
    reads: ['loadCandidates'],
    summary: 'Every driver ranked for one open load: free, in time for the pickup, clear of home time, fewest empty miles. Assign.',
    usage: '<SuggestDriver adapter={adapter} loadId={id} drive={driveFor} onClose={() => setId(null)} />',
  },
  {
    name: 'LoadPlanBoard',
    file: 'LoadPlanBoard.tsx',
    piece: 'PlanTimeline',
    pieceFile: 'PlanTimeline.tsx',
    reads: ['loadPlanBoard'],
    summary: 'Seven days of every driver\'s loads, the empty miles into them, and home time, with trucks free per day.',
    usage: '<LoadPlanBoard adapter={adapter} drive={driveFor} />',
  },
  {
    name: 'DriverLoadPlan',
    file: 'DriverLoadPlan.tsx',
    piece: 'PlanList',
    pieceFile: 'PlanList.tsx',
    reads: ['loadDriverPlan'],
    summary: 'One driver\'s plan, load by load, with the leg into each and Take back. Reads that driver alone.',
    usage: '<DriverLoadPlan adapter={adapter} driverCode="PRAMAN" drive={driveFor} />',
  },
  {
    name: 'LegChip',
    file: 'LegChip.tsx',
    piece: null,
    pieceFile: null,
    reads: [],
    summary: 'Whether a truck reaches a pickup in time, as a chip. Shows no data of its own, so it needs no wrapper.',
    usage: '<LegChip leg={leg} />   <LegChip leg={leg} compact />',
  },
]

/** Component files that are not screens. sync.tsx is the PlanSync provider. */
export const SUPPORT_FILES: readonly string[] = ['sync.tsx']
