import { useState } from 'react'
import { Alert, Button, LinearProgress } from '@mui/material'
import DriverForm from './DriverForm.tsx'
import { useDriverRead } from './useDriverRead.ts'
import type { DriverChanges, DriverMasterAdapter, DriverRecord, NewDriver } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: one driver, to read and change -- or a new one to add.
//
//   <DriverEditor adapter={a} driverCode="TBOONE" onClose={...} />
//   <DriverEditor adapter={a} driverCode={null} onSaved={(d) => ...} />   add
//
// Reads that driver alone (loadDriver). Pay comes back for an admin and as
// null for dispatch, and the form follows what came back: the screen does
// not decide who sees pay, the server's answer does. A new driver reads
// nothing; adding one is the server's to refuse to anyone but an admin.
//
// Drawn inline, not in a dialog: DriverMaster puts it in one, a host can put
// it on a page of its own.
//
// Piece: DriverForm.
// ---------------------------------------------------------------------------
export interface DriverEditorProps {
  adapter: DriverMasterAdapter
  /** The driver to open; null to add a new one. */
  driverCode: string | null
  organizationId?: string | null
  /** For a new driver: codes in use, checked as one is typed. */
  takenCodes?: readonly string[]
  /** Told after each save, add, leaving or return, with the driver as stored. */
  onSaved?: ((driver: DriverRecord) => void) | null
  onClose?: (() => void) | null
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default function DriverEditor({ adapter, driverCode, organizationId = null, takenCodes = [], onSaved = null, onClose = null }: DriverEditorProps) {
  const { data, loading, error, changed, reload } = useDriverRead<DriverRecord | null>(
    driverCode === null ? null : (signal) => adapter.loadDriver({ organizationId, driverCode, signal }),
    [adapter, organizationId, driverCode],
  )
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function run(work: () => Promise<DriverRecord>) {
    setBusy(true)
    setActionError(null)
    try {
      const stored = await work()
      changed() // this form reads again, and so does the list if they share a DriverSync
      onSaved?.(stored)
    } catch (err) {
      setActionError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  if (driverCode === null) {
    return (
      <DriverForm record={null} takenCodes={takenCodes} busy={busy} error={actionError} onCancel={onClose}
        onAdd={(driver: NewDriver) => run(() => adapter.addDriver(driver))} />
    )
  }

  if (data === undefined) {
    return error
      ? <Alert severity="error" action={<Button color="inherit" size="small" onClick={reload}>Try again</Button>}>Could not load {driverCode}: {error}</Alert>
      : <LinearProgress aria-label={`Loading ${driverCode}`} />
  }
  if (data === null) return <Alert severity="warning">There is no driver {driverCode}.</Alert>

  const record = data
  return (
    <>
      {loading && <LinearProgress sx={{ mb: 1 }} aria-label="Refreshing" />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {/* Keyed by version: a fresh read -- after a save, or someone else's -- starts a fresh form. */}
      <DriverForm
        key={`${record.driverCode}@${record.version}`} record={record} busy={busy} error={actionError} onCancel={onClose}
        onSave={(changes: DriverChanges) => run(() => adapter.saveDriver(record.driverCode, record.version, changes))}
        onSetActive={(active: boolean) => run(() => adapter.setDriverActive(record.driverCode, record.version, active))}
      />
    </>
  )
}
