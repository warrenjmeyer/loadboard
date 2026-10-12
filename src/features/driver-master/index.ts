// ---------------------------------------------------------------------------
// Everything a host app imports from this folder comes through here.
//
// Modules (a wrapper that loads, around a piece that draws) are listed in
// modules.ts, which is exported too.
// ---------------------------------------------------------------------------

// Modules: the loading wrappers a host mounts.
export { default as DriverMaster } from './DriverMaster.tsx'
export type { DriverMasterProps } from './DriverMaster.tsx'
export { default as DriverDirectory } from './DriverDirectory.tsx'
export type { DriverDirectoryProps } from './DriverDirectory.tsx'
export { default as DriverEditor } from './DriverEditor.tsx'
export type { DriverEditorProps } from './DriverEditor.tsx'

// Pieces: draw from data the host already holds.
export { default as DriverMasterView } from './DriverMasterView.tsx'
export type { DriverMasterViewProps } from './DriverMasterView.tsx'
export { default as DriverTable } from './DriverTable.tsx'
export type { DriverTableProps } from './DriverTable.tsx'
export { default as DriverForm } from './DriverForm.tsx'
export type { DriverFormProps } from './DriverForm.tsx'

// Keeping separately-mounted modules in step, and the loading pattern they share.
export { DriverSync, useDriverSync } from './sync.tsx'
export { useDriverRead } from './useDriverRead.ts'
export type { DriverRead } from './useDriverRead.ts'

// The register.
export { MODULES } from './modules.ts'
export type { ModuleInfo } from './modules.ts'

// What each scoped read returns, and to whom -- the server's specification.
export { scopeDriverList, scopeDriver, allowed, REFUSED } from './scope.ts'
export type { Caller, Allowed } from './scope.ts'

// The rules.
export {
  checkDetails, checkPay, checkNewDriver, normalizeDetails, normalizeCode, changesBetween, hasChanges, applyChanges, applyActive,
  suggestCode, matchesSearch, byName, fullName, describePay, homeTimeRule, summaryOf, blankNewDriver, sentence,
  LIMITS, US_STATES, CODE_PATTERN, PAY_FREQUENCY_LABEL, DRIVER_TYPE_LABEL, STALE_MESSAGE, PAY_IS_ADMINS,
} from './rules.ts'
export type { Problems } from './rules.ts'

// The contract.
export { checkDriverList, checkDriverRecord, DRIVER_TYPES, PAY_BASES, PAY_FREQUENCIES } from './contract.ts'
export type {
  DriverSummary, DriverDetails, DriverPay, DriverRecord, DriverChanges, NewDriver, DriverList, DriverMasterAdapter, ReadArgs,
  DriverType, PayBasis, PayFrequency, IsoMoment,
} from './contract.ts'
