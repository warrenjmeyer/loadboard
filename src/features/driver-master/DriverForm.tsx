import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'
import {
  DRIVER_TYPE_LABEL, LIMITS, PAY_FREQUENCY_LABEL, US_STATES, blankNewDriver, changesBetween, checkDetails, checkNewDriver, checkPay,
  describePay, fullName, hasChanges, homeTimeRule, normalizeCode, suggestCode,
} from './rules.ts'
import { DRIVER_TYPES, PAY_BASES, PAY_FREQUENCIES } from './contract.ts'
import type { DriverChanges, DriverDetails, DriverPay, DriverRecord, DriverType, NewDriver, PayBasis, PayFrequency } from './contract.ts'

// ---------------------------------------------------------------------------
// PIECE: one driver's form, given the driver -- or an empty one to add a
// driver. It fetches nothing and stores nothing: a save goes out through
// onSave as only the fields that changed, a new driver through onAdd whole,
// leaving or coming back through onSetActive. The new record comes back in
// through props; mount it with key={record.version} so a fresh read starts
// a fresh form.
//
// The pay section is drawn only when the record came WITH pay -- an admin's.
// A dispatcher's record has pay: null, so there is nothing to show and
// nothing to send. (A new driver always has it: only an admin adds one.)
//
// Problems show beside each field, in rules.ts's words, once the field has
// been left or a save tried -- not while the first letter is being typed.
// ---------------------------------------------------------------------------
export interface DriverFormProps {
  /** The driver as read; null for a new one. */
  record: DriverRecord | null
  /** Codes in use, active or not, so a new code is checked as it is typed.
   * The server checks again either way. */
  takenCodes?: readonly string[]
  busy?: boolean
  error?: string | null
  onSave?: ((changes: DriverChanges) => Promise<void> | void) | null
  onAdd?: ((driver: NewDriver) => Promise<void> | void) | null
  onSetActive?: ((active: boolean) => Promise<void> | void) | null
  onCancel?: (() => void) | null
}

type PayDraft = Omit<DriverPay, 'payRate'> & { payRate: string }

const detailsOf = (r: DriverRecord | NewDriver): DriverDetails => ({
  firstName: r.firstName, lastName: r.lastName, address1: r.address1, address2: r.address2, city: r.city, state: r.state,
  postalCode: r.postalCode, country: r.country, job: r.job, jobType: r.jobType, location: r.location, department: r.department,
  unitNo: r.unitNo, truckDescription: r.truckDescription,
})
const draftOf = (p: DriverPay): PayDraft => ({ ...p, payRate: p.payRate ? String(p.payRate) : '' })
const payOf = (d: PayDraft): DriverPay => ({ ...d, payRate: d.payRate.trim() === '' ? Number.NaN : Number(d.payRate) })

export default function DriverForm({ record, takenCodes = [], busy = false, error = null, onSave = null, onAdd = null, onSetActive = null, onCancel = null }: DriverFormProps) {
  const isNew = record === null
  const start = record ?? blankNewDriver()
  const [details, setDetails] = useState<DriverDetails>(() => detailsOf(start))
  const [driverType, setDriverType] = useState<DriverType>(start.driverType)
  const [pay, setPay] = useState<PayDraft | null>(() => (start.pay ? draftOf(start.pay) : null))
  const [code, setCode] = useState('')
  const [codeTyped, setCodeTyped] = useState(false)
  const [left, setLeft] = useState<Set<string>>(() => new Set())
  const [tried, setTried] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  // Until a code is typed, it follows the name: TBOONE for Terrell Boone.
  const shownCode = isNew && !codeTyped ? suggestCode(details.firstName, details.lastName, takenCodes) : code
  const payNow = pay ? payOf(pay) : null
  const problems = isNew
    ? checkNewDriver({ ...details, driverCode: shownCode, driverType, pay: payNow! }, takenCodes)
    : { ...checkDetails(details), ...(payNow ? checkPay(payNow, driverType) : {}) }
  const changes = record ? changesBetween(record, { details, driverType, pay: payNow }) : null
  const dirty = isNew || (changes !== null && hasChanges(changes))
  const fine = Object.keys(problems).length === 0

  const problem = (key: string) => (tried || left.has(key) ? problems[key] : undefined)
  const leave = (key: string) => () => setLeft((s) => (s.has(key) ? s : new Set(s).add(key)))
  const set = (key: keyof DriverDetails) => (e: { target: { value: string } }) => setDetails((d) => ({ ...d, [key]: e.target.value }))
  const setPayField = (key: keyof PayDraft) => (e: { target: { value: string } }) => setPay((p) => (p ? { ...p, [key]: e.target.value } : p))

  // Each detail field: its value, its limit, its problem once it has been left.
  const field = (key: keyof DriverDetails, label: string, extra: { required?: boolean; helper?: ReactNode; wide?: boolean } = {}) => (
    <TextField
      size="small" label={label} value={details[key] ?? ''} onChange={set(key)} onBlur={leave(key)}
      required={extra.required ?? true} error={Boolean(problem(key))} helperText={problem(key) || extra.helper}
      slotProps={{ htmlInput: { maxLength: (LIMITS as Record<string, number>)[key] } }}
      sx={extra.wide ? { gridColumn: { sm: '1 / -1' } } : undefined}
    />
  )

  function chooseType(next: DriverType) {
    setDriverType(next)
    // An owner is paid by the mile or a share; a company driver has no basis.
    setPay((p) => (p ? { ...p, payBasis: next === 'OWNER' ? (p.payBasis ?? 'MILEAGE') : null } : p))
  }

  async function submit() {
    setTried(true)
    if (!fine) return
    if (isNew) await onAdd?.({ ...details, driverCode: normalizeCode(shownCode), driverType, pay: payNow! })
    else if (changes && hasChanges(changes)) await onSave?.(changes)
  }

  const job = homeTimeRule(details.job)
  const usa = details.country.trim().toUpperCase() === 'USA'

  return (
    <Box component="form" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }}>
      {record && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" component="h3">{fullName(record)}</Typography>
          <Chip size="small" variant="outlined" label={record.driverCode} sx={{ fontFamily: 'monospace' }} />
          <Chip size="small" variant="outlined" label={DRIVER_TYPE_LABEL[record.driverType]} />
          {record.pay && <Chip size="small" variant="outlined" label={describePay(record.pay)} />}
          {!record.isActive && <Chip size="small" label="Left" />}
          {!record.hasLogin && <Chip size="small" color="warning" variant="outlined" label="No sign-in linked" />}
        </Stack>
      )}

      <Section title="Who they are">
        {field('firstName', 'First name')}
        {field('lastName', 'Last name')}
        {isNew && (
          <TextField
            size="small" label="Driver code" required value={shownCode}
            onChange={(e) => { setCodeTyped(true); setCode(e.target.value.toUpperCase()) }} onBlur={leave('driverCode')}
            error={Boolean(problem('driverCode'))}
            helperText={problem('driverCode') || 'How every other screen, the load board and GeoTab know them. It cannot be changed later.'}
            slotProps={{ htmlInput: { maxLength: LIMITS.driverCode, style: { fontFamily: 'monospace' } } }}
          />
        )}
      </Section>

      <Section title="Home">
        {field('address1', 'Address', { wide: true })}
        {field('address2', 'Address line 2', { required: false, wide: true })}
        {field('city', 'City', { helper: 'Home for the planner and the schedule: the GeoTab zone of this town.' })}
        {usa ? (
          <TextField
            select size="small" label="State" required value={(US_STATES as readonly string[]).includes(details.state) ? details.state : ''}
            onChange={set('state')} onBlur={leave('state')} error={Boolean(problem('state'))} helperText={problem('state')}
            slotProps={{ select: { MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}
          >
            {US_STATES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
        ) : field('state', 'State or province')}
        {field('postalCode', usa ? 'ZIP code' : 'Postal code')}
        {field('country', 'Country')}
      </Section>

      <Section title="Work">
        {field('job', 'Job', {
          helper: job ? `The planner counts this as ${job} for home time.` : 'No home-time rule matches this job, so the planner uses its default limit.',
        })}
        {field('jobType', 'Job type')}
        {field('location', 'Location')}
        {field('department', 'Department')}
        {field('unitNo', 'Truck', { required: false, helper: 'Their regular truck. GeoTab may put them in another on a given day.' })}
        {field('truckDescription', 'Truck description', { required: false })}
      </Section>

      {pay ? (
        <Section title="Pay" note="Admin only. Dispatch never receives these.">
          <TextField
            select size="small" label="Driver type" required value={driverType} onChange={(e) => chooseType(e.target.value as DriverType)}
            error={Boolean(problem('driverType'))} helperText={problem('driverType')}
          >
            {DRIVER_TYPES.map((t) => <MenuItem key={t} value={t}>{DRIVER_TYPE_LABEL[t]}</MenuItem>)}
          </TextField>
          <TextField
            size="small" label="SSN, last four" required value={pay.ssnLast4} onChange={setPayField('ssnLast4')} onBlur={leave('ssnLast4')}
            error={Boolean(problem('ssnLast4'))} helperText={problem('ssnLast4') || 'Only the last four are kept, as on their statement.'}
            slotProps={{ htmlInput: { maxLength: 4, inputMode: 'numeric', autoComplete: 'off' } }}
          />
          {driverType === 'OWNER' && (
            <TextField
              select size="small" label="Paid by" required value={pay.payBasis ?? ''}
              onChange={(e) => setPay((p) => (p ? { ...p, payBasis: e.target.value as PayBasis } : p))}
              error={Boolean(problem('payBasis'))} helperText={problem('payBasis')}
            >
              {PAY_BASES.map((b) => <MenuItem key={b} value={b}>{b === 'MILEAGE' ? 'The mile' : 'A share of the linehaul'}</MenuItem>)}
            </TextField>
          )}
          <TextField
            size="small" label={pay.payBasis === 'PERCENTAGE' ? 'Share of the linehaul' : 'Dollars a mile'} required
            value={pay.payRate} onChange={setPayField('payRate')} onBlur={leave('payRate')}
            error={Boolean(problem('payRate'))}
            helperText={problem('payRate') || (pay.payBasis === 'PERCENTAGE' ? 'As a fraction: 0.68 for 68%.' : 'Up to four decimal places: 0.6200.')}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            select size="small" label="Paid" required value={pay.payFrequency}
            onChange={(e) => setPay((p) => (p ? { ...p, payFrequency: e.target.value as PayFrequency } : p))}
          >
            {PAY_FREQUENCIES.map((f) => <MenuItem key={f} value={f}>{PAY_FREQUENCY_LABEL[f]}</MenuItem>)}
          </TextField>
          <TextField
            size="small" label="Pay group" required value={pay.payGroup} onChange={setPayField('payGroup')} onBlur={leave('payGroup')}
            error={Boolean(problem('payGroup'))} helperText={problem('payGroup')}
            slotProps={{ htmlInput: { maxLength: LIMITS.payGroup } }}
          />
        </Section>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Pay, the SSN and the driver type are kept by an admin.
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {tried && !fine && <Alert severity="warning" sx={{ mb: 2 }}>Some fields need fixing first. Each says what is wrong.</Alert>}

      {confirmLeave && record && (
        <Alert
          severity="warning" sx={{ mb: 2 }}
          action={(
            <Stack direction="row" spacing={1}>
              <Button color="inherit" size="small" onClick={() => setConfirmLeave(false)} disabled={busy}>Keep them</Button>
              <Button color="inherit" size="small" variant="outlined" disabled={busy}
                onClick={async () => { await onSetActive?.(false); setConfirmLeave(false) }}>
                Mark as left
              </Button>
            </Stack>
          )}
        >
          Mark {fullName(record)} as left? They drop off the planner, the schedule and the load plans. Their stays and
          plans are kept, and they can come back.
        </Alert>
      )}

      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {record && onSetActive && !dirty && !confirmLeave && (record.isActive
          ? <Button color="warning" disabled={busy} onClick={() => setConfirmLeave(true)}>Mark as left</Button>
          : <Button color="success" disabled={busy} onClick={() => void onSetActive(true)}>Bring back</Button>)}
        {record && dirty && <Typography variant="caption" sx={{ color: 'text.secondary' }}>Unsaved changes</Typography>}
        <Box sx={{ flex: 1 }} />
        {onCancel && <Button onClick={onCancel} disabled={busy}>{dirty ? 'Cancel' : 'Close'}</Button>}
        {(isNew ? onAdd : onSave) && (
          <Button type="submit" variant="contained" disabled={busy || !dirty}>
            {busy ? 'Saving…' : isNew ? 'Add driver' : 'Save'}
          </Button>
        )}
      </Stack>
    </Box>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, mb: 2.5 }}>
      <Typography component="legend" variant="overline" sx={{ color: 'text.secondary', p: 0 }}>{title}</Typography>
      {note && <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: -0.5, mb: 1 }}>{note}</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: 0.5 }}>{children}</Box>
    </Box>
  )
}
