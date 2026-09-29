import type { ChipProps } from '@mui/material'
import type { BlockKind, Status } from './planHome.ts'

// ---------------------------------------------------------------------------
// What each status is called on screen, and how loud it is.
//
// Colours are MUI palette NAMES, never hex: the host's theme decides what
// "error" and "warning" look like, so the planner picks up its colours from
// the app it lands in instead of bringing the load board's along.
//
// Filled is for "act today", outlined for "worth knowing". Only LATE and
// TIGHT are filled red and amber; OVERDUE is outlined, because with no
// request open it is a conversation to start, not a deadline being missed.
//
// Keyed by the names in DRVR.fk_get_me_home_status. The table holds the
// codes; the words a dispatcher reads live here, next to the colours.
//
// Typed as a Record over Status, so a status added to planHome.ts and
// forgotten here is a compile error rather than a chip with no label.
// ---------------------------------------------------------------------------
export interface StatusMeta {
  label: string
  count: (n: number) => string
  color: ChipProps['color']
  variant: ChipProps['variant']
  hint: string
}

export const STATUS: Record<Status, StatusMeta> = {
  LATE: {
    label: "Won't make it",
    count: (n) => `${n} won't make it`,
    color: 'error',
    variant: 'filled',
    hint: 'Cannot be home by the requested time, even starting now. The request needs a new date or a different plan.',
  },
  TIGHT: {
    label: 'Route home now',
    count: (n) => `${n} to route now`,
    color: 'warning',
    variant: 'filled',
    hint: 'Can still make it, with less than 12 hours to spare. The next load should point them home.',
  },
  OVERDUE: {
    label: 'Overdue home',
    count: (n) => `${n} overdue`,
    color: 'error',
    variant: 'outlined',
    hint: 'Out longer than company policy allows, and no home time requested yet.',
  },
  NOLOCATION: {
    label: "Can't place",
    count: (n) => `${n} can't place`,
    color: 'default',
    variant: 'outlined',
    hint: 'No position and no current load, so there is no trip home to plan.',
  },
  SOON: {
    label: 'Due home soon',
    count: (n) => `${n} due soon`,
    color: 'warning',
    variant: 'outlined',
    hint: 'Close to the days-out limit for this kind of driver.',
  },
  ONTRACK: {
    label: 'On track',
    count: (n) => `${n} on track`,
    color: 'success',
    variant: 'outlined',
    hint: 'Home by the requested time with at least 12 hours to spare.',
  },
  ONTHEROAD: {
    label: 'On the road',
    count: (n) => `${n} on the road`,
    color: 'default',
    variant: 'outlined',
    hint: 'No request open and well inside the days-out limit.',
  },
  HOME: {
    label: 'Home',
    count: (n) => `${n} home`,
    color: 'success',
    variant: 'filled',
    hint: 'The truck is empty and in the driver’s home town.',
  },
}

// The statuses worth a chip in the header. The rest are the quiet majority.
export const ATTENTION: readonly Status[] = ['LATE', 'TIGHT', 'OVERDUE', 'NOLOCATION', 'SOON']

// How each kind of block in a trip is named and coloured. Palette paths
// again, resolved by the theme.
export const BLOCK: Record<BlockKind, { label: string; color: string }> = {
  drive: { label: 'Drive', color: 'primary.main' },
  break: { label: '30-minute break', color: 'warning.main' },
  rest: { label: '10-hour rest', color: 'grey.500' },
  restart: { label: '34-hour restart', color: 'error.main' },
}
