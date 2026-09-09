// ---------------------------------------------------------------------------
// The arithmetic of a pay run, with no database and no HTTP in it.
//
// A pay run turns delivered loads into settlement lines. The rules are the
// ones settlement_01_ddl.sql and tools/gen_owner_settlements.mjs already
// state; this is the one place they are written as code the API runs:
//
//   company driver         pay = (loaded + empty miles) x pay_rate
//   owner/op, MILEAGE      pay = (loaded + empty miles) x pay_rate
//   owner/op, PERCENTAGE   pay = the load's rate x pay_rate  (0.68 = 68%)
//
// Money is rounded to the cent per line, and totals are sums of the rounded
// lines, so what the statement prints adds up to what it says.
// ---------------------------------------------------------------------------

const { linesFor } = require('./deductionRules')
const { linesFrom } = require('./chargeRules')

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Round-tripped through Date, because Date.parse('2026-02-30') does not
// fail -- it quietly becomes March 2nd, and a pay period ending on a day that
// does not exist should be refused, not moved.
function validDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s
}

// The period and check date, checked for shape and order. A check date
// before the period ends is paying for work not yet done, which is not a
// thing payroll does; the first existing settlements ran Sunday to Saturday
// with a check the following Friday, and that is the default below.
function validatePeriod({ periodStart, periodEnd, checkDate }) {
  const errors = []
  if (!validDate(periodStart)) errors.push('Period start must be YYYY-MM-DD.')
  if (!validDate(periodEnd)) errors.push('Period end must be YYYY-MM-DD.')
  if (!validDate(checkDate)) errors.push('Check date must be YYYY-MM-DD.')
  if (errors.length) return errors
  if (periodEnd < periodStart) errors.push('The period ends before it starts.')
  if (checkDate < periodEnd) errors.push('The check date is before the period ends.')
  return errors
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// The most recent complete Sunday-to-Saturday week before `today`, and the
// Friday after it. Given a Wednesday the 9th, that is Sunday 30th to
// Saturday 5th, paid Friday 11th.
function defaultPeriod(today) {
  const d = new Date(`${today}T00:00:00Z`)
  const dow = d.getUTCDay()               // 0 = Sunday
  const lastSaturday = addDays(today, -(dow + 1))
  const periodEnd = lastSaturday
  const periodStart = addDays(periodEnd, -6)
  const checkDate = addDays(periodEnd, 6)
  return { periodStart, periodEnd, checkDate }
}

// One settlement line from one load and the driver who ran it.
function routeFor(load, driver) {
  const loadedMiles = Number(load.miles) || 0
  const emptyMiles = Number(load.emptyMiles) || 0
  const totalMiles = loadedMiles + emptyMiles
  const owner = driver.driverType === 'OWNER'
  const percentage = owner && driver.payBasis === 'PERCENTAGE'
  const payRate = Number(driver.payRate)

  return {
    orderNo: load.id,
    loadId: load.id,
    dispatchNo: null,
    unitNo: load.unitNo || driver.unitNo || null,
    routeDetail: `${load.origin} - ${load.destination}`.toUpperCase(),
    loadedMiles,
    emptyMiles,
    totalMiles,
    // The carrier's revenue on the load, shown to an owner/operator because
    // a percentage driver's pay is a share of it and a mileage driver is
    // entitled to see what the truck earned. Company drivers are not paid on
    // it and their statement does not print it.
    linehaulRevenue: owner ? round2(Number(load.rate)) : null,
    payRate,
    payAmount: percentage ? round2(Number(load.rate) * payRate) : round2(totalMiles * payRate),
  }
}

// Group unpaid loads by driver into the settlements a run would create.
//
//   loads           delivered, unpaid, each with driverCode and deliveredDate
//   drivers         keyed by driverCode: name, driverType, payBasis, payRate, unitNo
//   existing        set of driverCodes that already have a settlement on checkDate
//   deductions      keyed by driverCode: that driver's standing orders
//   escrowBalances  keyed by driverCode: { escrowCode: balance on the last statement }
//   charges         keyed by driverCode: unpaid accessorials on their delivered loads
//
// A driver with unpaid charges and no unpaid loads still gets a settlement:
// a lumper receipt handed in after the load was settled is paid on its own
// rather than waiting for the next load.
//
// A load delivered before the period started but never paid is carried into
// this run rather than left behind -- that is what a real pay run does with a
// straggler -- and marked so the reviewer can see it.
//
// Standing deductions are applied AFTER the routes are summed, because the
// per-mile ones need the total. What comes out is the net: route pay plus the
// (negative) deduction lines. Nothing here is a reimbursement or a revenue
// line; those are still entered by hand.
function plan(loads, drivers, { periodStart, periodEnd, checkDate, existing = new Set(), deductions = {}, escrowBalances = {}, charges = {} }) {
  const byDriver = new Map()

  const entryFor = (driverCode) => {
    const driver = drivers[driverCode]
    if (!driver) return null
    if (!byDriver.has(driverCode)) {
      byDriver.set(driverCode, {
        driverCode,
        name: driver.name,
        driverType: driver.driverType,
        payBasis: driver.payBasis || null,
        payRate: Number(driver.payRate),
        conflict: existing.has(driverCode),
        routes: [],
        charges: [],
        carriedOver: 0,
      })
    }
    return byDriver.get(driverCode)
  }

  for (const [driverCode, list] of Object.entries(charges)) {
    if (!list || !list.length) continue
    const entry = entryFor(driverCode)
    if (entry) entry.charges = linesFrom(list)
  }

  for (const load of loads) {
    const driver = drivers[load.driverCode]
    if (!driver) continue
    const entry = entryFor(load.driverCode)
    const route = routeFor(load, driver)
    route.deliveredDate = load.deliveredDate
    route.carriedOver = load.deliveredDate < periodStart
    if (route.carriedOver) entry.carriedOver++
    entry.routes.push(route)
  }

  const settlements = [...byDriver.values()].map((s) => {
    const routes = s.routes.sort((a, b) => a.deliveredDate.localeCompare(b.deliveredDate) || a.loadId.localeCompare(b.loadId))
    const totalMiles = routes.reduce((t, r) => t + r.totalMiles, 0)
    const routePay = round2(routes.reduce((t, r) => t + r.payAmount, 0))
    const taken = linesFor(deductions[s.driverCode] || [], {
      totalMiles, escrowBalances: escrowBalances[s.driverCode] || {}, checkDate,
    })
    const extras = s.charges
    const revenueTotal = round2(extras.filter((l) => l.type === 'REVENUE').reduce((t, l) => t + l.amount, 0))
    const reimbursementTotal = round2(extras.filter((l) => l.type === 'REIMBURSEMENT').reduce((t, l) => t + l.amount, 0))
    return {
      ...s,
      routes,
      loadCount: routes.length,
      loadedMiles: routes.reduce((t, r) => t + r.loadedMiles, 0),
      emptyMiles: routes.reduce((t, r) => t + r.emptyMiles, 0),
      totalMiles,
      routePay,
      // Every line the statement will carry, in the order it prints them:
      // extra pay, money back, then what comes out.
      lines: [...extras, ...taken.lines],
      escrow: taken.escrow,
      balanceUpdates: taken.balanceUpdates,
      revenueTotal,
      reimbursementTotal,
      extrasTotal: round2(revenueTotal + reimbursementTotal),
      deductionTotal: taken.deductionTotal,
      net: round2(routePay + revenueTotal + reimbursementTotal + taken.deductionTotal),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  return {
    periodStart,
    periodEnd,
    checkDate,
    settlements,
    totals: {
      drivers: settlements.length,
      loads: settlements.reduce((t, s) => t + s.loadCount, 0),
      miles: settlements.reduce((t, s) => t + s.totalMiles, 0),
      pay: round2(settlements.reduce((t, s) => t + s.routePay, 0)),
      extras: round2(settlements.reduce((t, s) => t + s.extrasTotal, 0)),
      deductions: round2(settlements.reduce((t, s) => t + s.deductionTotal, 0)),
      net: round2(settlements.reduce((t, s) => t + s.net, 0)),
      conflicts: settlements.filter((s) => s.conflict).length,
    },
  }
}

// CK-YYMMDD-NNNN, the shape every existing statement carries.
function documentNo(checkDate, seq) {
  const yymmdd = checkDate.slice(2).replace(/-/g, '')
  return `CK-${yymmdd}-${String(seq).padStart(4, '0')}`
}

module.exports = { round2, validatePeriod, defaultPeriod, addDays, routeFor, plan, documentNo }
