// ---------------------------------------------------------------------------
// THE SCHEDULE'S MODULES -- everything a host can mount on its own.
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
// The same shape as the planner's modules.ts, written again rather than
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
    name: 'HomeTimeSchedule',
    file: 'HomeTimeSchedule.tsx',
    piece: 'ScheduleView',
    pieceFile: 'ScheduleView.tsx',
    reads: ['loadQueue', 'loadBoard'],
    summary: 'The whole dispatch tab: DecisionQueue above ScheduleBoard, in one ScheduleSync so a decision redraws the board.',
    usage: '<HomeTimeSchedule adapter={adapter} organizationId={org} verdictFor={verdictFor} />',
  },
  {
    name: 'DecisionQueue',
    file: 'DecisionQueue.tsx',
    piece: 'DecisionList',
    pieceFile: 'DecisionList.tsx',
    reads: ['loadQueue'],
    summary: 'Requests waiting on dispatch, oldest first, with Approve, Decline and the planner\'s verdict.',
    usage: '<DecisionQueue adapter={adapter} verdictFor={verdictFor} />',
  },
  {
    name: 'ScheduleBoard',
    file: 'ScheduleBoard.tsx',
    piece: 'Board',
    pieceFile: 'Board.tsx',
    reads: ['loadBoard'],
    summary: 'Two weeks of who is home when, with a count of drivers home each day. Click a stay for its details.',
    usage: '<ScheduleBoard adapter={adapter} />',
  },
  {
    name: 'StayDetails',
    file: 'StayDetails.tsx',
    piece: 'StayDialog',
    pieceFile: 'StayDialog.tsx',
    reads: ['loadStay'],
    summary: 'One stay by id, with the moves its status allows -- openable from anywhere.',
    usage: '<StayDetails adapter={adapter} stayId={id} onClose={() => setId(null)} />',
  },
  {
    name: 'DriverHomeTime',
    file: 'DriverHomeTime.tsx',
    piece: 'DriverStays',
    pieceFile: 'DriverStays.tsx',
    reads: ['loadDriverStays'],
    summary: 'The driver\'s side: their own stays, dispatch\'s answers, and a request form. Reads that driver alone.',
    usage: '<DriverHomeTime adapter={adapter} driverCode={me} />',
  },
  {
    name: 'RequestHomeTime',
    file: 'RequestHomeTime.tsx',
    piece: 'RequestForm',
    pieceFile: 'RequestForm.tsx',
    reads: ['loadDriverStays'],
    summary: 'A "Request home time" button and its form, for any screen a driver uses.',
    usage: '<RequestHomeTime adapter={adapter} driverCode={me} />',
  },
]

/** Component files that are not screens. sync.tsx is the ScheduleSync provider. */
export const SUPPORT_FILES: readonly string[] = ['sync.tsx']
