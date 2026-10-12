import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@mui/material'
import DriverDirectory from './DriverDirectory.tsx'
import DriverEditor from './DriverEditor.tsx'
import { DriverSync } from './sync.tsx'
import type { DriverMasterAdapter } from './contract.ts'

// ---------------------------------------------------------------------------
// MODULE: the whole Driver Master tab, for dispatch and admin.
//
//   <DriverMaster adapter={adapter} organizationId={org} />
//
// A composition, not a screen of its own: DriverDirectory, and DriverEditor
// in a dialog over it, under one DriverSync so that saving a driver redraws
// their line in the list. Each reads its own slice. A host that wants them
// apart -- the editor on a driver's own page, say -- mounts them separately.
//
// What the tab offers follows the server's answers: Add driver only when the
// list says the caller may add, the pay section only when the driver came
// with pay. The same component is dispatch's tab and admin's.
//
// Piece: DriverMasterView (the same screen drawn from data already held).
// ---------------------------------------------------------------------------
export interface DriverMasterProps {
  adapter: DriverMasterAdapter
  organizationId?: string | null
}

/** Which driver is open: a code, one being added, or nobody. */
type Open = string | { adding: true } | null

export default function DriverMaster({ adapter, organizationId = null }: DriverMasterProps) {
  const [open, setOpen] = useState<Open>(null)
  const [taken, setTaken] = useState<string[]>([])
  const close = () => setOpen(null)
  const adding = typeof open === 'object' && open !== null

  return (
    <DriverSync>
      <DriverDirectory
        adapter={adapter} organizationId={organizationId} selectedCode={typeof open === 'string' ? open : null}
        onOpen={setOpen} onAdd={() => setOpen({ adding: true })}
        onLoaded={(list) => setTaken((was) => [...new Set([...was, ...list.drivers.map((d) => d.driverCode)])])}
      />
      <Dialog open={open !== null} onClose={close} fullWidth maxWidth="md" aria-labelledby="driver-editor-title">
        <DialogTitle id="driver-editor-title">{adding ? 'Add a driver' : 'Driver'}</DialogTitle>
        <DialogContent>
          {open !== null && (
            <DriverEditor
              adapter={adapter} organizationId={organizationId} driverCode={adding ? null : (open as string)} takenCodes={taken}
              // A driver just added opens as themselves, so what was stored is what is seen.
              onSaved={(d) => { if (adding) setOpen(d.driverCode) }}
              onClose={close}
            />
          )}
        </DialogContent>
      </Dialog>
    </DriverSync>
  )
}
