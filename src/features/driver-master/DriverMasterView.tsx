import { useState } from 'react'
import { Alert, Button, Dialog, DialogContent, DialogTitle, LinearProgress, Typography } from '@mui/material'
import DriverTable from './DriverTable.tsx'
import DriverForm from './DriverForm.tsx'
import type { DriverChanges, DriverList, DriverRecord, NewDriver } from './contract.ts'

// ---------------------------------------------------------------------------
// PIECE: the Driver Master tab, given the data. The list, and the form in a
// dialog over it. It fetches nothing and stores nothing: saving, adding and
// leaving go out through onSave, onAdd and onSetActive, and the new data
// comes back in through props. DriverMaster wires that to an adapter; a host
// with its own data layer can wire it to that instead.
//
// `records` are the drivers the host holds in full -- pay included only if
// the person looking may see it. A driver opened who is not among them is
// said to be missing, not drawn from the list line.
// ---------------------------------------------------------------------------
export interface DriverMasterViewProps {
  list?: DriverList | null
  records?: readonly DriverRecord[]
  loading?: boolean
  error?: string | null
  showInactive?: boolean
  onShowInactive?: ((show: boolean) => void) | null
  /** Each rejects with an Error whose message is fit to show. */
  onSave?: ((driverCode: string, version: string, changes: DriverChanges) => Promise<void>) | null
  onAdd?: ((driver: NewDriver) => Promise<void>) | null
  onSetActive?: ((driverCode: string, version: string, active: boolean) => Promise<void>) | null
  onRefresh?: (() => void) | null
}

type Open = string | { adding: true } | null
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function DriverMasterView({
  list = null, records = [], loading = false, error = null, showInactive = false, onShowInactive = null,
  onSave = null, onAdd = null, onSetActive = null, onRefresh = null,
}: DriverMasterViewProps) {
  const [open, setOpen] = useState<Open>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const adding = typeof open === 'object' && open !== null
  const record = typeof open === 'string' ? records.find((r) => r.driverCode === open) ?? null : null

  const close = () => { setOpen(null); setActionError(null) }
  async function run(work: () => Promise<void>, after?: () => void) {
    setBusy(true)
    setActionError(null)
    try {
      await work()
      after?.()
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  if (!list) {
    return error
      ? <Alert severity="error" action={onRefresh ? <Button color="inherit" size="small" onClick={onRefresh}>Try again</Button> : undefined}>Could not load the drivers: {error}</Alert>
      : (
        <>
          <LinearProgress aria-label="Loading the drivers" />
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>Loading the drivers…</Typography>
        </>
      )
  }

  return (
    <>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Refreshing" />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <DriverTable list={list} showInactive={showInactive} onShowInactive={onShowInactive}
        selectedCode={typeof open === 'string' ? open : null} onOpen={setOpen} onAdd={onAdd ? () => setOpen({ adding: true }) : null} />

      <Dialog open={open !== null} onClose={close} fullWidth maxWidth="md" aria-labelledby="driver-view-title">
        <DialogTitle id="driver-view-title">{adding ? 'Add a driver' : 'Driver'}</DialogTitle>
        <DialogContent>
          {adding ? (
            <DriverForm record={null} takenCodes={list.drivers.map((d) => d.driverCode)} busy={busy} error={actionError} onCancel={close}
              onAdd={onAdd ? (d) => run(() => onAdd(d), () => setOpen(d.driverCode)) : null} />
          ) : record ? (
            <DriverForm
              key={`${record.driverCode}@${record.version}`} record={record} busy={busy} error={actionError} onCancel={close}
              onSave={onSave ? (c) => run(() => onSave(record.driverCode, record.version, c)) : null}
              onSetActive={onSetActive ? (a) => run(() => onSetActive(record.driverCode, record.version, a)) : null}
            />
          ) : open !== null ? (
            <Alert severity="warning">There is no driver {String(open)} here.</Alert>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
