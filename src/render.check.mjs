// ---------------------------------------------------------------------------
// Smoke-render every page component through React's server renderer.
//
//   node src/render.check.mjs
//
// This catches what `vite build` cannot. The build resolves imports and parses
// JSX; it never runs a component. A page that calls an undefined function
// during render, misuses a hook, or has a typo inside a JSX expression builds
// perfectly and then shows a blank screen with a stack trace in the console.
//
// Effects do not run under server rendering, so nothing here touches the
// network or the database. It answers one question -- does this component
// render at all, in each of its states -- which is exactly the question
// nothing else in this repo was asking.
//
// .mjs because the repo is ESM at the root but this needs to be run directly
// rather than bundled, and .check so `node --test` leaves it alone.
// ---------------------------------------------------------------------------
import { createServer } from 'vite'
import { renderToString } from 'react-dom/server'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

// ---------------------------------------------------------------------------
// A settlement payload, shaped exactly like the one the API returns.
//
// Written out rather than fetched, because the point of this file is to run
// without a database. The figures are internally consistent -- the totals are
// the sums of the lines above them -- so a component that quietly renders the
// wrong field shows up as a wrong number here rather than as something that
// merely fails to crash.
// ---------------------------------------------------------------------------
function statementFixture({ driverType = 'COMPANY', payBasis = null } = {}) {
  const percentage = payBasis === 'PERCENTAGE'

  const routes = [
    {
      orderNo: 'O-21001', loadId: 'L-31001', dispatchNo: 'D-51001', unitNo: 'Demo - 21',
      routeDetail: 'CEDAR RAPIDS, IA - CHICAGO, IL',
      loadedMiles: 224, emptyMiles: 31, totalMiles: 255,
      linehaulRevenue: percentage ? 660.8 : null,
      payRate: percentage ? 0.68 : 1.88, payAmount: percentage ? 449.34 : 479.4,
      rpm: percentage ? 1.762 : 1.88,
    },
    {
      // A flat line with no miles and no load -- the case that made the
      // original print "150" in a column headed "rate per mile".
      orderNo: 'SPECIAL', loadId: null, dispatchNo: null, unitNo: 'Demo - 21',
      routeDetail: 'LAYOVER - CHICAGO, IL',
      loadedMiles: 0, emptyMiles: 0, totalMiles: 0,
      linehaulRevenue: null,
      payRate: 0, payAmount: 150.0, rpm: 150.0,
    },
  ]

  const routePay = routes.reduce((t, r) => t + r.payAmount, 0)
  const revenue = [
    { type: 'REVENUE', orderNo: null, code: null, description: 'FUEL SURCHARGE', advanceReference: null, amount: 412.6 },
  ]
  const reimbursements = [
    { type: 'REIMBURSEMENT', orderNo: 'O-21001', code: null, description: 'TOLLS', advanceReference: null, amount: 64.3 },
  ]
  const deductions = [
    { type: 'DEDUCTION', orderNo: null, code: null, description: 'TRUCK PAYMENT', advanceReference: null, amount: -712.0 },
    { type: 'DEDUCTION', orderNo: null, code: null, description: 'ADVANCE', advanceReference: 'CD-93308', amount: -300.0 },
  ]

  const revenueTotal = 412.6
  const reimbursementTotal = 64.3
  const deductionTotal = -1012.0
  const settlementTotal = routePay + revenueTotal + reimbursementTotal + deductionTotal

  return {
    driver: {
      driverCode: 'RVASQUEZ', firstName: 'Rey', lastName: 'Vasquez',
      address1: '418 Sycamore Street', address2: null,
      city: 'Cedar Rapids', state: 'IA', postalCode: '52401', country: 'USA',
      ssnLast4: '3308', job: driverType === 'OWNER' ? 'Owner Operator' : 'OTR Driver',
      payRate: percentage ? 0.68 : 1.88, payFrequency: 'W',
      payGroup: 'HMLOO', location: 'Cedar Rapids, IA',
      department: 'Linehaul', jobType: driverType === 'OWNER' ? 'Owner Operator' : 'Company Driver',
      driverType, payBasis,
      unitNo: 'Demo - 21', truckDescription: '2021 Freightliner Cascadia',
    },
    settlement: {
      checkDate: '2026-08-28', periodStart: '2026-08-16',
      periodEnd: '2026-08-22', documentNo: 'CK-260828-2003',
    },
    routes,
    revenue,
    perDiem: [],
    reimbursements,
    deductions,
    totals: {
      loadedMiles: 224, emptyMiles: 31, totalMiles: 255,
      routePay,
      revenue: revenueTotal, perDiem: 0,
      reimbursements: reimbursementTotal, deductions: deductionTotal,
      settlementTotal,
    },
    ytd: { loadedMiles: 672, emptyMiles: 93, totalMiles: 765, routePay: routePay * 3 },
    comparison: {
      compensation: {
        lines: [
          { description: 'Trip Pay', weekly: routePay, ytd: routePay * 3 },
          { description: 'FUEL SURCHARGE', weekly: 412.6, ytd: 1237.8 },
        ],
        weekly: routePay + 412.6,
        ytd: routePay * 3 + 1237.8,
      },
      reimbursements: {
        lines: [{ description: 'TOLLS', weekly: 64.3, ytd: 192.9 }],
        weekly: 64.3,
        ytd: 192.9,
      },
      deductions: {
        lines: [
          { description: 'ADVANCE', weekly: -300.0, ytd: -300.0 },
          { description: 'TRUCK PAYMENT', weekly: -712.0, ytd: -2136.0 },
        ],
        weekly: -1012.0,
        ytd: -2436.0,
      },
      total: {
        weekly: routePay + 412.6 + 64.3 - 1012.0,
        ytd: routePay * 3 + 1237.8 + 192.9 - 2436.0,
      },
    },
    escrow: [
      { code: 'MAINT', description: 'Maintenance Escrow', beginningBalance: 2650.0, transactionAmount: 125.0, currentBalance: 2775.0 },
      // A brand new account, still at zero. The original hid exactly this row.
      { code: 'TIRE', description: 'Tire Escrow', beginningBalance: 0, transactionAmount: 0, currentBalance: 0 },
    ],
    escrowTotal: 2775.0,
  }
}

// Each entry is a state the component can actually be in. Rendering only the
// happy path would miss the branches that exist precisely because something
// went wrong -- which are the ones nobody looks at until they matter.
const cases = [
  ['SignIn', '/src/pages/SignIn.jsx', { onSignedIn() {} }],
  ['Register', '/src/pages/Register.jsx', {}],
  ['SetPassword', '/src/pages/SetPassword.jsx', { token: 'x'.repeat(43) }],
  ['VerifyEmail', '/src/pages/VerifyEmail.jsx', { token: 'x'.repeat(43) }],

  ['AccessNotice 401', '/src/components/AccessNotice.jsx', { error: 'Sign in to continue.', status: 401 }],
  ['AccessNotice 403', '/src/components/AccessNotice.jsx', { error: 'Not yours.', status: 403 }],
  ['AccessNotice 500', '/src/components/AccessNotice.jsx', { error: 'boom', status: 500 }],

  ['AddLoadForm unknown', '/src/components/AddLoadForm.jsx', { user: undefined, onAddLoad() {} }],
  ['AddLoadForm anon', '/src/components/AddLoadForm.jsx', { user: null, canAdd: false, onAddLoad() {} }],
  ['AddLoadForm pending', '/src/components/AddLoadForm.jsx',
    { user: { email: 'a@b.co', role: 'none', pendingApproval: true }, canAdd: false, onAddLoad() {} }],
  ['AddLoadForm driver', '/src/components/AddLoadForm.jsx',
    { user: { email: 'a@b.co', role: 'driver', pendingApproval: false }, canAdd: false, onAddLoad() {} }],
  ['AddLoadForm dispatcher', '/src/components/AddLoadForm.jsx',
    { user: { email: 'a@b.co', role: 'dispatcher', pendingApproval: false }, canAdd: true, onAddLoad() {} }],

  // The settlements board, with both kinds of driver in it. The $/mi column
  // means different things per row and one of them declines to answer, which
  // is the sort of rule that is invisible until someone screenshots it.
  ['SettlementTable mixed', '/src/components/SettlementTable.jsx', {
    settlements: [
      {
        driverCode: 'JSMITH', driverName: 'James Smith', driverType: 'COMPANY',
        checkDate: '2026-08-21', periodStart: '2026-08-09', periodEnd: '2026-08-15',
        documentNo: 'CK-260821-0015', loadCount: 4, miles: 2055,
        settlementTotal: 1570.35, perMile: 0.76, hasDeductions: true,
      },
      {
        driverCode: 'RVASQUEZ', driverName: 'Rey Vasquez', driverType: 'OWNER',
        checkDate: '2026-08-21', periodStart: '2026-08-09', periodEnd: '2026-08-15',
        documentNo: 'CK-260821-2002', loadCount: 4, miles: 1226,
        settlementTotal: 875.34, perMile: 0.71, hasDeductions: true,
      },
      // All flat pay, no miles: the other reason the cell dashes.
      {
        driverCode: 'SOAKS', driverName: 'Sherman Oaks', driverType: 'COMPANY',
        checkDate: '2026-08-14', periodStart: '2026-08-02', periodEnd: '2026-08-08',
        documentNo: 'CK-260814-0010', loadCount: 1, miles: 0,
        settlementTotal: 150.0, perMile: null, hasDeductions: false,
      },
    ],
  }],
  ['SettlementTable empty', '/src/components/SettlementTable.jsx', { settlements: [] }],

  // The two settlements. Both are reached at the same URL and chosen by
  // driverType, so both have to render from one payload shape -- which is
  // exactly what these three cases check.
  ['CompanyStatement', '/src/components/settlement/CompanyStatement.jsx',
    { statement: statementFixture() }],
  ['OwnerStatement mileage', '/src/components/settlement/OwnerStatement.jsx',
    { statement: statementFixture({ driverType: 'OWNER', payBasis: 'MILEAGE' }) }],
  ['OwnerStatement percentage', '/src/components/settlement/OwnerStatement.jsx',
    { statement: statementFixture({ driverType: 'OWNER', payBasis: 'PERCENTAGE' }) }],

  // The pieces the owner/operator statement is assembled from, in the states
  // that are easy to get wrong.
  ['EarningsByLoad pct', '/src/components/settlement/EarningsByLoad.jsx', (() => {
    const s = statementFixture({ driverType: 'OWNER', payBasis: 'PERCENTAGE' })
    return { routes: s.routes, totals: s.totals, payBasis: 'PERCENTAGE' }
  })()],
  ['WeeklyYtd summary', '/src/components/settlement/WeeklyYtd.jsx', {
    title: 'Summary', variant: 'summary',
    lines: [{ description: 'Compensation', weekly: 1041.4, ytd: 3124.2 }],
    weekly: 1041.4, ytd: 3124.2,
  }],
  ['EscrowSummary', '/src/components/settlement/EscrowSummary.jsx', (() => {
    const s = statementFixture({ driverType: 'OWNER', payBasis: 'MILEAGE' })
    return { escrow: s.escrow, total: s.escrowTotal }
  })()],
  // Every deduction here is a fixed cost with no order number, so the table
  // has nothing to show and must say so rather than render an empty grid.
  ['LinesByLoad empty', '/src/components/settlement/LinesByLoad.jsx', (() => {
    const s = statementFixture({ driverType: 'OWNER', payBasis: 'MILEAGE' })
    return {
      title: 'Deductions by Load', lines: s.deductions, routes: s.routes,
      emptyNote: 'No deductions were attributed to a specific load.',
    }
  })()],
]

let failed = 0

for (const [label, path, props] of cases) {
  try {
    const mod = await vite.ssrLoadModule(path)

    // Wrapped in a router because the settlement components render <Link>,
    // which throws outside one. MemoryRouter keeps its history in memory
    // rather than touching window.history, which is what makes it the one
    // that works under a server renderer. It adds no markup of its own, so
    // the components that do not need it are unaffected.
    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(mod.default, props))
    )

    // Strip tags so the log shows what a person would actually read. A
    // component that renders 400 bytes of empty divs is not obviously broken
    // from a byte count, but it is obvious from a blank string.
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    if (label.endsWith('unknown')) {
      // The one case that SHOULD render nothing: /api/me has not answered yet,
      // and guessing would flash the wrong prompt at someone.
      if (html !== '') throw new Error(`expected nothing while identity is unknown, got ${html.length} bytes`)
      console.log(`  ok  ${label.padEnd(24)} renders nothing, correctly`)
      continue
    }

    if (!text) throw new Error('rendered no readable text')
    console.log(`  ok  ${label.padEnd(24)} "${text.slice(0, 56)}${text.length > 56 ? '...' : ''}"`)
  } catch (err) {
    failed++
    console.log(`  FAIL ${label}: ${err.message}`)
  }
}

await vite.close()
console.log(failed ? `\n${failed} FAILED` : `\nALL RENDER (${cases.length} states)`)
process.exit(failed ? 1 : 0)
