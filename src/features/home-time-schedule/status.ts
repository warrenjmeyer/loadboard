import type { ChipProps } from '@mui/material'
import type { StayStatus } from './contract.ts'

// ---------------------------------------------------------------------------
// How each status looks: a chip in lists and dialogs, a bar on the board.
// Palette names only, never colours, so the host's theme decides -- the same
// rule as the planner's status.ts. Typed over every StayStatus, so a status
// added to the contract and forgotten here does not compile.
//
// On the board the four statuses that occupy days read as a progression:
// dashed outline (asked), filled (agreed), strong fill (there), grey (was).
// ---------------------------------------------------------------------------
export interface StayLook {
  label: string
  chip: { color: ChipProps['color']; variant: ChipProps['variant'] }
  /** null for statuses that never occupy the board. */
  bar: { fill: string | null; border: string; dashed: boolean; text: string } | null
}

export const STAY_LOOK: Record<StayStatus, StayLook> = {
  REQUESTED: {
    label: 'Requested',
    chip: { color: 'warning', variant: 'outlined' },
    bar: { fill: null, border: 'warning.main', dashed: true, text: 'warning.dark' },
  },
  APPROVED: {
    label: 'Approved',
    chip: { color: 'primary', variant: 'filled' },
    bar: { fill: 'primary.light', border: 'primary.main', dashed: false, text: 'primary.contrastText' },
  },
  HOME: {
    label: 'Home',
    chip: { color: 'success', variant: 'filled' },
    bar: { fill: 'success.main', border: 'success.dark', dashed: false, text: 'success.contrastText' },
  },
  DONE: {
    label: 'Was home',
    chip: { color: 'default', variant: 'filled' },
    bar: { fill: 'grey.300', border: 'grey.400', dashed: false, text: 'text.secondary' },
  },
  DECLINED: {
    label: 'Declined',
    chip: { color: 'error', variant: 'outlined' },
    bar: null,
  },
  CANCELLED: {
    label: 'Cancelled',
    chip: { color: 'default', variant: 'outlined' },
    bar: null,
  },
}
