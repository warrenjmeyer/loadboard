import { Chip, Tooltip } from '@mui/material'
import type { Status } from './planHome.ts'
import { STATUS } from './status.ts'

// One status, as a chip. With `count` it becomes a header tally -- "2 to
// route now" -- which is the same fact about a group instead of one driver.
export default function StatusChip({ status, count = null, size = 'small' }: {
  status: Status
  count?: number | null
  size?: 'small' | 'medium'
}) {
  const meta = STATUS[status]
  return (
    <Tooltip title={meta.hint}>
      <Chip
        size={size}
        color={meta.color}
        variant={meta.variant}
        label={count === null ? meta.label : meta.count(count)}
      />
    </Tooltip>
  )
}
