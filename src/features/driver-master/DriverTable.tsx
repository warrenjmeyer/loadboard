import { useState } from 'react'
import {
  Box, Button, Chip, FormControlLabel, InputAdornment, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import { DRIVER_TYPE_LABEL, fullName, matchesSearch } from './rules.ts'
import type { DriverList } from './contract.ts'

// ---------------------------------------------------------------------------
// PIECE: the driver list, given the list. Search, a switch for drivers who
// have left, and Add driver when the list says the caller may add. Opening a
// driver and adding one go out through onOpen and onAdd; what to do then is
// the host's (DriverDirectory and DriverMaster open DriverEditor).
//
// The search is the piece's own -- it narrows what is already here. Whether
// drivers who have left are here at all is the READ's (includeInactive), so
// that switch is a prop: the wrapper reads again when it moves.
// ---------------------------------------------------------------------------
export interface DriverTableProps {
  list: DriverList
  /** Whether the list includes drivers who have left. */
  showInactive?: boolean
  /** Without it, the switch is not offered. */
  onShowInactive?: ((show: boolean) => void) | null
  selectedCode?: string | null
  onOpen?: ((driverCode: string) => void) | null
  /** Offered only when list.you.canAdd. */
  onAdd?: (() => void) | null
}

export default function DriverTable({ list, showInactive = false, onShowInactive = null, selectedCode = null, onOpen = null, onAdd = null }: DriverTableProps) {
  const [search, setSearch] = useState('')
  const shown = list.drivers.filter((d) => matchesSearch(d, search))
  const total = list.drivers.length

  return (
    <Box>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 1.5 }}>
        <TextField
          size="small" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, code, town or truck" aria-label="Search drivers" sx={{ minWidth: 260 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">Find</InputAdornment> } }}
        />
        {onShowInactive && (
          <FormControlLabel
            control={<Switch size="small" checked={showInactive} onChange={(e) => onShowInactive(e.target.checked)} />}
            label="Include drivers who have left"
          />
        )}
        <Box sx={{ flex: 1 }} />
        {list.you.canAdd && onAdd && <Button variant="contained" size="small" onClick={onAdd}>Add driver</Button>}
      </Stack>

      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 1 }}>
        {search.trim()
          ? `${shown.length} of ${total} ${total === 1 ? 'driver matches' : 'drivers match'}`
          : `${total} ${total === 1 ? 'driver' : 'drivers'}${showInactive ? ', including those who have left' : ''}`}
      </Typography>

      {total === 0 ? (
        <Typography sx={{ color: 'text.secondary', py: 2 }}>No drivers yet.</Typography>
      ) : shown.length === 0 ? (
        <Typography sx={{ color: 'text.secondary', py: 2 }}>Nobody matches "{search.trim()}".</Typography>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" aria-label="Drivers">
            <TableHead>
              <TableRow>
                <TableCell>Driver</TableCell>
                <TableCell>Home</TableCell>
                <TableCell>Job</TableCell>
                <TableCell>Truck</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((d) => {
                const open = onOpen ? () => onOpen(d.driverCode) : undefined
                return (
                  <TableRow
                    key={d.driverCode} hover={Boolean(onOpen)} selected={d.driverCode === selectedCode}
                    onClick={open} tabIndex={onOpen ? 0 : undefined}
                    onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } : undefined}
                    sx={{ cursor: onOpen ? 'pointer' : 'default', ...(d.isActive ? {} : { '& td': { color: 'text.disabled' } }) }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'inherit' }}>{fullName(d)}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>{d.driverCode}</Typography>
                    </TableCell>
                    <TableCell>{d.city}, {d.state}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ color: 'inherit' }}>{d.job}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{DRIVER_TYPE_LABEL[d.driverType]}</Typography>
                    </TableCell>
                    <TableCell>{d.unitNo || '—'}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                        {!d.isActive && <Chip size="small" label="Left" />}
                        {d.isActive && !d.hasLogin && <Chip size="small" color="warning" variant="outlined" label="No sign-in" />}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
