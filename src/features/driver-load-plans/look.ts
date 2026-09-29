import type { ChipProps } from '@mui/material'
import type { LegVerdict } from './rules.ts'
import type { LoadStatus } from './contract.ts'

// ---------------------------------------------------------------------------
// How each verdict and load status looks. Palette names only, never colours,
// so the host's theme decides -- the rule in both other tabs. Typed over every
// value, so one added to the rules and forgotten here does not compile.
// ---------------------------------------------------------------------------
export interface VerdictLook {
  label: string
  color: ChipProps['color']
  /** The palette colour for a mark on the board; null for none. */
  mark: string | null
}

export const VERDICT_LOOK: Record<LegVerdict, VerdictLook> = {
  ON_TIME: { label: 'On time', color: 'success', mark: null },
  TIGHT: { label: 'Tight', color: 'warning', mark: 'warning.main' },
  LATE: { label: 'Late', color: 'error', mark: 'error.main' },
  UNKNOWN: { label: "Can't tell", color: 'default', mark: 'text.disabled' },
}

export interface LoadLook {
  label: string
  /** A load bar on the board: filled when under way, outlined when lined up. */
  bar: { fill: string | null; border: string; text: string } | null
}

export const LOAD_LOOK: Record<LoadStatus, LoadLook> = {
  'In Transit': { label: 'Under way', bar: { fill: 'primary.main', border: 'primary.dark', text: 'primary.contrastText' } },
  Covered: { label: 'Planned', bar: { fill: null, border: 'primary.main', text: 'primary.dark' } },
  Available: { label: 'Open', bar: null },
  Delivered: { label: 'Delivered', bar: null },
  Cancelled: { label: 'Cancelled', bar: null },
}

export const STAY_LOOK: Record<'APPROVED' | 'HOME', { label: string; fill: string; text: string }> = {
  APPROVED: { label: 'Home time', fill: 'info.light', text: 'info.contrastText' },
  HOME: { label: 'Home', fill: 'success.light', text: 'success.contrastText' },
}
