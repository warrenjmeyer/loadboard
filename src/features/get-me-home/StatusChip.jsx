import { Chip, Tooltip } from '@mui/material'
import { STATUS } from './status.js'

// One status, as a chip. With `count` it becomes a header tally -- "2 to
// route now" -- which is the same fact about a group instead of one driver.
export default function StatusChip({ status, count = null, size = 'small' }) {
  const meta = STATUS[status] || STATUS.unknown
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
