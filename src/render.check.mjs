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
// Plain data, plain JS: imported directly rather than through Vite, so one
// render state draws the real state borders and not a hand-written stand-in.
// In the browser these arrive through import() the first time a map draws.
import { STATE_BORDERS } from './lib/stateOutlines.js'

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

// A load in the shape GET /api/loads returns since the dispatch work: every
// column present, most of them null. Cases override what they care about.
function blankLoad(overrides = {}) {
  return {
    id: 'L-10412', origin: 'Dubuque, IA', destination: 'Chicago, IL',
    miles: 182, rate: 585, equipment: 'Dry Van', status: 'Available',
    driverCode: null, unitNo: null, deliveredDate: null,
    pickupStart: null, pickupEnd: null, deliveryStart: null, deliveryEnd: null,
    customerName: null, referenceNo: null,
    shipperName: null, shipperAddress: null, shipperPhone: null,
    consigneeName: null, consigneeAddress: null, consigneePhone: null,
    commodity: null, weightLbs: null, pieces: null, hazmat: false, tempF: null, notes: null,
    ...overrides,
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

  // One load, in the two states the API can hand back. A delivered load names
  // a driver and a date; a current one has both nulled -- and has them nulled
  // for an anonymous visitor even when a driver exists, which is the case that
  // decides whether the page says "Not delivered" or leaks a name.
  ['LoadCard delivered', '/src/components/LoadCard.jsx', {
    load: {
      id: 'L-30012', origin: 'Dubuque, IA', destination: 'Joliet, IL',
      miles: 187, rate: 585, equipment: 'Dry Van', status: 'Delivered',
      driverCode: 'JSMITH', deliveredDate: '2026-08-14',
    },
  }],
  ['LoadCard current', '/src/components/LoadCard.jsx', {
    load: {
      id: 'L-10412', origin: 'Cedar Rapids, IA', destination: 'Kansas City, MO',
      miles: 310, rate: 1240, equipment: 'Reefer', status: 'Available',
      driverCode: null, deliveredDate: null,
    },
  }],
  // The same load as a signed-in dispatcher sees it: one more field, linking
  // out to the lane in MyGeotab. Anonymous visitors get null and no field at
  // all, which is the state above.
  ['LoadCard with geotab', '/src/components/LoadCard.jsx', {
    load: {
      id: 'L-10412', origin: 'Cedar Rapids, IA', destination: 'Kansas City, MO',
      miles: 310, rate: 1240, equipment: 'Reefer', status: 'Available',
      driverCode: null, deliveredDate: null,
    },
    geotabUrl: "https://my.geotab.com/demo_millstream/#routes,search:'CEDAR%20RAPIDS,%20IA%20-%20KANSAS%20CITY,%20MO'",
  }],

  // A load with everything filled in, as a dispatcher sees it: parties,
  // freight, notes, unit. The sections that are conditional on data all have
  // data here, so a typo in any of them fails this rather than the page.
  ['LoadCard full', '/src/components/LoadCard.jsx', {
    load: {
      id: 'L-10420', origin: 'Cedar Rapids, IA', destination: 'Chicago, IL',
      miles: 224, rate: 760, equipment: 'Reefer', status: 'In Transit',
      driverCode: 'RVASQUEZ', unitNo: 'Demo - 21', deliveredDate: null,
      pickupStart: '2026-09-10T08:00:00', pickupEnd: '2026-09-10T14:00:00',
      deliveryStart: '2026-09-11T06:00:00', deliveryEnd: '2026-09-11T06:00:00',
      customerName: 'Quaker Oats', referenceNo: 'PO-88213',
      shipperName: 'Quaker Oats Plant', shipperAddress: '418 2nd St NE, Cedar Rapids, IA 52401', shipperPhone: '319-555-0100',
      consigneeName: 'Jewel DC', consigneeAddress: '1955 W North Ave, Melrose Park, IL 60160', consigneePhone: '708-555-0199',
      commodity: 'Frozen breakfast', weightLbs: 42000, pieces: 26, hazmat: true, tempF: -10,
      notes: 'Check in at guard shack. Lumper on delivery, get receipt.',
    },
  }],

  // The dispatch panel in the two shapes that matter: everything, for a
  // dispatcher, and the driver's two-button version. The roster fetch is an
  // effect and does not run here, so the dispatcher sees "Loading roster".
  ['DispatchPanel dispatcher', '/src/components/DispatchPanel.jsx', {
    load: blankLoad({ status: 'Available' }),
    actions: { canEdit: true, canAssign: true, transitions: ['Covered', 'Cancelled'] },
    onChange: async () => {},
  }],
  ['DispatchPanel driver', '/src/components/DispatchPanel.jsx', {
    load: blankLoad({ status: 'In Transit', driverCode: 'JSMITH', unitNo: 'Demo - 01' }),
    actions: { canEdit: false, canAssign: false, transitions: ['Delivered'] },
    onChange: async () => {},
  }],

  ['LoadHistory', '/src/components/LoadHistory.jsx', {
    events: [
      { id: 1, at: '2026-09-09T14:02:11.000Z', actor: 'dispatch@millstream.example', type: 'Created', fromStatus: null, toStatus: null, driverCode: null, detail: 'Dubuque, IA → Chicago, IL' },
      { id: 2, at: '2026-09-09T14:05:40.000Z', actor: 'dispatch@millstream.example', type: 'Assigned', fromStatus: null, toStatus: null, driverCode: 'JSMITH', detail: 'Assigned to JSMITH in Demo - 01' },
      { id: 3, at: '2026-09-09T14:05:40.000Z', actor: 'dispatch@millstream.example', type: 'Status', fromStatus: 'Available', toStatus: 'Covered', driverCode: null, detail: null },
    ],
  }],
  ['LoadHistory empty', '/src/components/LoadHistory.jsx', { events: [] }],

  // The shared field set, blank. Both the add form and the edit panel render
  // this, so one case covers the inputs of both.
  ['LoadForm blank', '/src/components/LoadForm.jsx', {
    form: { id: '', origin: '', destination: '', miles: '', rate: '', equipment: 'Reefer', pickupStart: '', pickupEnd: '', deliveryStart: '', deliveryEnd: '', customerName: '', referenceNo: '', shipperName: '', shipperAddress: '', shipperPhone: '', consigneeName: '', consigneeAddress: '', consigneePhone: '', commodity: '', weightLbs: '', pieces: '', hazmat: false, tempF: '', notes: '' },
    onChange() {}, showId: true,
  }],

  // The board table without sort buttons, which is how the driver page uses
  // it, with one of every status so every badge class is exercised.
  ['LoadTable static', '/src/components/LoadTable.jsx', {
    loads: ['Available', 'Covered', 'In Transit', 'Delivered', 'Cancelled'].map((status, i) => blankLoad({
      id: `L-1000${i}`, status, driverCode: i ? 'JSMITH' : null, hazmat: i === 2,
      pickupStart: i ? '2026-09-10T08:00:00' : null,
    })),
  }],

  ['MyLoads loading', '/src/pages/MyLoads.jsx', {}],

  // The fleet tables, with the states that colour a cell: in service, in the
  // shop, retired, an owner/operator's truck, a plate expiring soon and one
  // already expired. Then the same tables without the Edit column, which is
  // how a driver sees them.
  ['TruckTable', '/src/components/fleet/TruckTable.jsx', {
    trucks: [
      { unitNo: 'Demo - 01', description: '2021 Freightliner Cascadia', plate: 'ML 4471', plateState: 'IA', status: 'Active', ownerType: 'COMPANY', ownerDriverCode: null,
        registrationExpires: '2027-03-31', registrationDays: 203, inspectionDue: '2026-09-25', inspectionDays: 16,
        regularDriver: { driverCode: 'HBARNETT', name: 'Hollis Barnett' }, currentLoad: { id: 'L-10413', status: 'In Transit', destination: 'Kansas City, MO' } },
      { unitNo: 'Demo - 11', description: '2018 Freightliner Cascadia', plate: 'ML 4481', plateState: 'IA', status: 'Shop', ownerType: 'COMPANY', ownerDriverCode: null,
        registrationExpires: '2026-03-31', registrationDays: -162, inspectionDue: null, inspectionDays: null,
        regularDriver: { driverCode: 'JPACE', name: 'Jo Pace' }, currentLoad: null },
      { unitNo: 'Demo - 21', description: '2021 Freightliner Cascadia', plate: null, plateState: null, status: 'Retired', ownerType: 'OWNER', ownerDriverCode: 'RVASQUEZ',
        registrationExpires: null, registrationDays: null, inspectionDue: null, inspectionDays: null,
        regularDriver: null, currentLoad: null },
    ],
    onEdit() {},
  }],
  ['TruckTable read-only', '/src/components/fleet/TruckTable.jsx', {
    trucks: [{ unitNo: 'Demo - 01', description: '2021 Freightliner Cascadia', plate: 'ML 4471', plateState: 'IA', status: 'Active', ownerType: 'COMPANY', ownerDriverCode: null, registrationExpires: '2027-03-31', registrationDays: 203, inspectionDue: '2027-01-15', inspectionDays: 128, regularDriver: null, currentLoad: null }],
  }],
  ['TrailerTable', '/src/components/fleet/TrailerTable.jsx', {
    trailers: [
      { trailerNo: 'T-201', trailerType: 'Reefer', description: "53' Utility 3000R / Carrier X4", plate: 'TR 2201', plateState: 'IA', status: 'Active',
        registrationExpires: '2027-03-31', registrationDays: 203, inspectionDue: '2026-09-09', inspectionDays: 0, currentLoad: { id: 'L-10412', status: 'Covered', destination: 'Chicago, IL' } },
      { trailerNo: 'T-308', trailerType: 'Flatbed', description: "48' Reitnouer MaxMiser", plate: 'TR 3308', plateState: 'IA', status: 'Retired',
        registrationExpires: '2026-03-31', registrationDays: -162, inspectionDue: '2026-02-01', inspectionDays: -220, currentLoad: null },
    ],
    onEdit() {},
  }],
  ['TruckForm new', '/src/components/fleet/TruckForm.jsx', {
    form: { unitNo: '', description: '', modelYear: '', make: '', model: '', vin: '', plate: '', plateState: '', status: 'Active', ownerType: 'OWNER', ownerDriverCode: '', registrationExpires: '', inspectionDue: '', notes: '' },
    onChange() {}, isNew: true, drivers: [{ driverCode: 'RVASQUEZ', name: 'Rey Vasquez' }],
  }],
  ['TrailerForm new', '/src/components/fleet/TrailerForm.jsx', {
    form: { trailerNo: '', trailerType: 'Reefer', description: '', plate: '', plateState: '', status: 'Active', registrationExpires: '', inspectionDue: '', notes: '' },
    onChange() {}, isNew: true,
  }],
  ['DueDate expired', '/src/components/fleet/DueDate.jsx', { iso: '2026-03-31', days: -162 }],
  ['Fleet loading', '/src/pages/Fleet.jsx', {}],

  // Customers: the table with an active broker, a shipper, and one on hold;
  // the card in its hold state (which draws the warning); the form; and the
  // load form with a customer dropdown instead of a text box.
  ['CustomerTable', '/src/components/customers/CustomerTable.jsx', {
    customers: [
      { customerId: 1, name: 'Prairie Freight Partners', customerType: 'Broker', mcNumber: 'MC-655910', contactName: 'Lupe Ortega', phone: '402-555-0151', paymentTermsDays: 15, status: 'Active', currentLoads: 4, deliveredLoads: 31, deliveredRevenue: 38212.5, lastDelivered: '2026-08-22' },
      { customerId: 2, name: 'Mississippi Valley Foods', customerType: 'Shipper', mcNumber: null, contactName: 'Carla Jensen', phone: null, paymentTermsDays: 30, status: 'Active', currentLoads: 0, deliveredLoads: 0, deliveredRevenue: 0, lastDelivered: null },
      { customerId: 6, name: 'Riverbend Logistics LLC', customerType: 'Broker', mcNumber: 'MC-812377', contactName: 'Kevin Marsh', phone: '312-555-0199', paymentTermsDays: 45, status: 'Hold', currentLoads: 2, deliveredLoads: 12, deliveredRevenue: 14900, lastDelivered: '2026-08-20' },
    ],
    onEdit() {},
  }],
  ['CustomerCard on hold', '/src/components/customers/CustomerCard.jsx', {
    customer: { customerId: 6, name: 'Riverbend Logistics LLC', customerType: 'Broker', mcNumber: 'MC-812377', address1: '55 E Monroe St', city: 'Chicago', state: 'IL', postalCode: '60603', phone: '312-555-0199', email: 'ap@riverbendlog.example', contactName: 'Kevin Marsh', paymentTermsDays: 45, creditLimit: 10000, status: 'Hold', notes: 'Two invoices past 60 days.', currentLoads: 2, deliveredLoads: 12, deliveredRevenue: 14900, openRevenue: 2100, lastDelivered: '2026-08-20' },
  }],
  ['CustomerForm', '/src/components/customers/CustomerForm.jsx', {
    form: { name: '', customerType: 'Shipper', mcNumber: '', address1: '', city: '', state: '', postalCode: '', phone: '', email: '', contactName: '', paymentTermsDays: '30', creditLimit: '', status: 'Active', notes: '' },
    onChange() {},
  }],
  ['LoadForm with customers', '/src/components/LoadForm.jsx', {
    form: { id: '', origin: '', destination: '', miles: '', rate: '', equipment: 'Dry Van', pickupStart: '', pickupEnd: '', deliveryStart: '', deliveryEnd: '', customerId: '', customerName: 'Typed Name Co', referenceNo: '', shipperName: '', shipperAddress: '', shipperPhone: '', consigneeName: '', consigneeAddress: '', consigneePhone: '', commodity: '', weightLbs: '', pieces: '', hazmat: false, tempF: '', notes: '' },
    onChange() {},
    customers: [{ customerId: 1, name: 'Prairie Freight Partners', status: 'Active' }, { customerId: 6, name: 'Riverbend Logistics LLC', status: 'Hold' }],
  }],
  ['LoadCard customer on hold', '/src/components/LoadCard.jsx', {
    load: blankLoad({ customerId: 6, customerName: 'Riverbend Logistics LLC', customerStatus: 'Hold', referenceNo: 'RB-1' }),
  }],
  ['Customers loading', '/src/pages/Customers.jsx', {}],

  // The pay run preview: a company driver with a straggler, a percentage
  // owner/operator, and one driver already paid on this date.
  ['PayrunPreview', '/src/components/payroll/PayrunPreview.jsx', {
    plan: {
      periodStart: '2026-08-30', periodEnd: '2026-09-05', checkDate: '2026-09-11',
      settlements: [
        { driverCode: 'JSMITH', name: 'James Smith', driverType: 'COMPANY', payBasis: null, payRate: 0.62, conflict: false, carriedOver: 1,
          loadCount: 2, loadedMiles: 364, emptyMiles: 40, totalMiles: 404, routePay: 250.48,
          routes: [
            { loadId: 'L-1', routeDetail: 'DUBUQUE, IA - CHICAGO, IL', deliveredDate: '2026-08-20', totalMiles: 202, payAmount: 125.24, carriedOver: true },
            { loadId: 'L-2', routeDetail: 'DUBUQUE, IA - CHICAGO, IL', deliveredDate: '2026-09-03', totalMiles: 202, payAmount: 125.24, carriedOver: false },
          ] },
        { driverCode: 'MOKONKWO', name: 'Miriam Okonkwo', driverType: 'OWNER', payBasis: 'PERCENTAGE', payRate: 0.68, conflict: true, carriedOver: 0,
          loadCount: 1, loadedMiles: 182, emptyMiles: 0, totalMiles: 182, routePay: 680,
          routes: [{ loadId: 'L-3', routeDetail: 'DUBUQUE, IA - CHICAGO, IL', deliveredDate: '2026-09-04', totalMiles: 182, payAmount: 680, carriedOver: false }] },
      ],
      totals: { drivers: 2, loads: 3, miles: 586, pay: 930.48, conflicts: 1 },
    },
    selected: new Set(['JSMITH']),
    onToggle() {},
  }],
  ['PayrunPreview empty', '/src/components/payroll/PayrunPreview.jsx', {
    plan: { periodStart: '2026-08-30', periodEnd: '2026-09-05', checkDate: '2026-09-11', settlements: [], totals: { drivers: 0, loads: 0, miles: 0, pay: 0, conflicts: 0 } },
    selected: new Set(), onToggle() {},
  }],
  ['Payroll loading', '/src/pages/Payroll.jsx', {}],

  // Standing deductions: the four kinds in one table, the form in its escrow
  // shape, and a preview row that nets below zero.
  ['DeductionTable', '/src/components/payroll/DeductionTable.jsx', {
    deductions: [
      { deductionId: 1, code: 'TRUCKPAY', description: 'TRUCK PAYMENT', basis: 'FLAT', amount: 712, escrowCode: null, balance: null, startDate: null, endDate: null, active: true },
      { deductionId: 2, code: 'FUEL', description: 'FUEL - COMCHEK', basis: 'PER_MILE', amount: 0.592, escrowCode: null, balance: null, startDate: null, endDate: null, active: true },
      { deductionId: 3, code: 'MAINT', description: 'MAINTENANCE ESCROW', basis: 'FLAT', amount: 125, escrowCode: 'MAINT', balance: null, startDate: null, endDate: null, active: true },
      { deductionId: 4, code: 'ADV', description: 'ADVANCE', basis: 'FLAT', amount: 300, escrowCode: null, balance: 200, startDate: '2026-09-11', endDate: null, active: false },
    ],
    onEdit() {},
  }],
  ['DeductionTable empty', '/src/components/payroll/DeductionTable.jsx', { deductions: [] }],
  ['DeductionForm escrow', '/src/components/payroll/DeductionForm.jsx', {
    form: { code: 'MAINT', description: 'MAINTENANCE ESCROW', basis: 'FLAT', amount: '125', kind: 'escrow', escrowCode: 'MAINT', escrowOpening: '2400', balance: '', startDate: '', endDate: '', active: 'true', notes: '' },
    onChange() {}, isNew: true,
  }],
  ['PayrunPreview net negative', '/src/components/payroll/PayrunPreview.jsx', {
    plan: {
      periodStart: '2026-08-30', periodEnd: '2026-09-05', checkDate: '2026-09-11',
      settlements: [{
        driverCode: 'RVASQUEZ', name: 'Rey Vasquez', driverType: 'OWNER', payBasis: 'MILEAGE', payRate: 1.88, conflict: false, carriedOver: 0,
        loadCount: 1, loadedMiles: 182, emptyMiles: 0, totalMiles: 182, routePay: 342.16,
        routes: [{ loadId: 'L-1', routeDetail: 'DUBUQUE, IA - CHICAGO, IL', deliveredDate: '2026-09-03', totalMiles: 182, payAmount: 342.16, carriedOver: false }],
        lines: [
          { code: 'TRUCKPAY', description: 'TRUCK PAYMENT', amount: -712, escrowCode: null },
          { code: 'MAINT', description: 'MAINTENANCE ESCROW', amount: -125, escrowCode: 'MAINT' },
        ],
        deductionTotal: -837, net: -494.84,
      }],
      totals: { drivers: 1, loads: 1, miles: 182, pay: 342.16, deductions: -837, net: -494.84, conflicts: 0 },
    },
    selected: new Set(['RVASQUEZ']),
    onToggle() {},
  }],
  ['Deductions loading', '/src/pages/Deductions.jsx', {}],

  // Accessorials on a load: one paid, one not, as dispatch sees it (add and
  // remove), then as the driver sees it (a receipt button, no remove), then
  // empty for a reader who can do nothing.
  ['LoadCharges dispatch', '/src/components/LoadCharges.jsx', {
    charges: [
      { chargeId: 1, lineType: 'REVENUE', code: 'DETENTION', description: 'DETENTION - 2 HRS', amount: 90, billCustomer: true, billAmount: 150, receiptNote: null, createdBy: 'dispatch@millstream.example', createdUtc: '2026-09-09T14:00:00.000Z', paidOn: { documentNo: 'CK-260911-0003', checkDate: '2026-09-11', driverCode: 'JSMITH' } },
      { chargeId: 2, lineType: 'REIMBURSEMENT', code: 'LUMPER', description: 'LUMPER', amount: 125, billCustomer: true, billAmount: null, receiptNote: 'Receipt #4471, Jewel DC', createdBy: 'jsmith@example.invalid', createdUtc: '2026-09-09T18:00:00.000Z', paidOn: null },
    ],
    canAdd: 'all', canRemove: true, async onAdd() {}, async onRemove() {},
  }],
  ['LoadCharges driver', '/src/components/LoadCharges.jsx', {
    charges: [], canAdd: 'reimbursement', canRemove: false, async onAdd() {}, async onRemove() {},
  }],
  ['LoadCharges read-only', '/src/components/LoadCharges.jsx', {
    charges: [], canAdd: null, canRemove: false, async onAdd() {}, async onRemove() {},
  }],

  // Live from GeoTab: positions in every state a row can be in (fresh and
  // moving, stale and stopped, a swapped driver, never reported, no device),
  // the hours roster with a clock over and a driver Geotab does not know,
  // and the one-driver clocks on the load page and the driver's page.
  ['PositionTable', '/src/components/fleet/PositionTable.jsx', {
    database: 'demo_millstream',
    trucks: [
      { unitNo: 'Demo - 01', status: 'Active', regularDriver: { driverCode: 'HBARNETT', name: 'Hollis Barnett' }, currentLoad: { id: 'L-10413', status: 'In Transit', destination: 'Kansas City, MO' },
        geotabDeviceId: 'b1', reported: true, dateTime: '2026-09-09T14:55:00.000Z', ageMinutes: 5, latitude: 41.58681, longitude: -93.62499, speedMph: 65, bearing: 272, isDriving: true, communicating: true,
        driver: { driverCode: 'HBARNETT', name: 'Hollis Barnett' } },
      { unitNo: 'Demo - 05', status: 'Active', regularDriver: { driverCode: 'DFOSTER', name: 'Dale Foster' }, currentLoad: null,
        geotabDeviceId: 'b5', reported: true, dateTime: '2026-09-08T09:00:00.000Z', ageMinutes: 1800, latitude: 42.5, longitude: -90.66, speedMph: 0, bearing: null, isDriving: false, communicating: false,
        driver: { driverCode: 'TBOONE', name: 'Terrell Boone' } },
      { unitNo: 'Demo - 07', status: 'Active', regularDriver: { driverCode: 'LHARTMAN', name: 'Lena Hartman' }, currentLoad: null,
        geotabDeviceId: 'b7', reported: false, dateTime: null, ageMinutes: null, latitude: null, longitude: null, speedMph: null, bearing: null, isDriving: false, communicating: false, driver: null },
      { unitNo: 'Demo - 30', status: 'Shop', regularDriver: null, currentLoad: null,
        geotabDeviceId: null, reported: false, dateTime: null, ageMinutes: null, latitude: null, longitude: null, speedMph: null, bearing: null, isDriving: false, communicating: false, driver: null },
    ],
  }],
  ['PositionTable empty', '/src/components/fleet/PositionTable.jsx', { trucks: [] }],
  ['HoursTable', '/src/components/HoursTable.jsx', {
    drivers: [
      { driverCode: 'DFOSTER', name: 'Dale Foster', driverType: 'COMPANY', unitNo: 'Demo - 05', matched: true, status: 'D', statusLabel: 'Driving', statusGroup: 'D', statusSince: '2026-09-09T13:00:00.000Z', statusMinutes: 120,
        hasAvailability: true, driving: -600, duty: 3600, workday: 7200, cycle: 183600, rest: 0, cycleRest: 122400, exemptions: { sixteenHour: false, adverseDriving: true, offDutyDeferral: false } },
      { driverCode: 'HBARNETT', name: 'Hollis Barnett', driverType: 'COMPANY', unitNo: 'Demo - 01', matched: true, status: 'OFF', statusLabel: 'Off duty', statusGroup: 'OFF', statusSince: '2026-09-09T04:00:00.000Z', statusMinutes: 660,
        hasAvailability: true, driving: 39600, duty: 50400, workday: 50400, cycle: 200000, rest: 28800, cycleRest: 0, exemptions: { sixteenHour: true, adverseDriving: false, offDutyDeferral: false } },
      { driverCode: 'JSMITH', name: 'James Smith', driverType: 'COMPANY', unitNo: 'Demo - 02', matched: true, status: null, statusLabel: null, statusGroup: null, statusSince: null, statusMinutes: null,
        hasAvailability: false, driving: null, duty: null, workday: null, cycle: null, rest: null, cycleRest: null, exemptions: { sixteenHour: false, adverseDriving: false, offDutyDeferral: false } },
      { driverCode: 'NOBODY', name: 'No Match', driverType: 'OWNER', unitNo: null, matched: false, status: null, statusLabel: null, statusGroup: null, statusSince: null, statusMinutes: null,
        hasAvailability: false, driving: null, duty: null, workday: null, cycle: null, rest: null, cycleRest: null, exemptions: { sixteenHour: false, adverseDriving: false, offDutyDeferral: false } },
    ],
  }],
  ['HoursTable empty', '/src/components/HoursTable.jsx', { drivers: [] }],
  ['HoursClocks', '/src/components/HoursClocks.jsx', {
    hours: { driverCode: 'DFOSTER', name: 'Dale Foster', matched: true, status: 'ON', statusLabel: 'On duty', statusGroup: 'ON', statusMinutes: 35,
      hasAvailability: true, driving: 29700, duty: 5400, workday: 39600, cycle: 183600, rest: 1800, cycleRest: 122400, exemptions: { sixteenHour: true, adverseDriving: false, offDutyDeferral: false } },
  }],
  ['HoursClocks unmatched', '/src/components/HoursClocks.jsx', {
    hours: { driverCode: 'NOBODY', name: 'No Match', matched: false, status: null, hasAvailability: false, exemptions: {} },
  }],
  ['HoursClocks no logs', '/src/components/HoursClocks.jsx', {
    hours: { driverCode: 'JSMITH', name: 'James Smith', matched: true, status: null, hasAvailability: false, exemptions: {} },
  }],
  ['TruckNow moving', '/src/components/TruckNow.jsx', {
    database: 'demo_millstream',
    position: { unitNo: 'Demo - 01', geotabDeviceId: 'b1', reported: true, ageMinutes: 5, latitude: 41.58681, longitude: -93.62499, speedMph: 65, bearing: 272, isDriving: true, communicating: true, driver: { driverCode: 'HBARNETT', name: 'Hollis Barnett' } },
    hours: { driverCode: 'HBARNETT', name: 'Hollis Barnett', matched: true, status: 'D', statusLabel: 'Driving', statusGroup: 'D', statusMinutes: 120, hasAvailability: true, driving: 29700, duty: 38400, cycle: 183600, rest: 0, exemptions: {} },
  }],
  ['TruckNow stale, no hours', '/src/components/TruckNow.jsx', {
    position: { unitNo: 'Demo - 05', geotabDeviceId: 'b5', reported: true, ageMinutes: 1800, latitude: 42.5, longitude: -90.66, speedMph: 0, bearing: null, isDriving: false, communicating: false, driver: null },
    hours: null,
  }],
  ['TruckNow not connected', '/src/components/TruckNow.jsx', { position: null, hours: null, notConnected: true }],
  ['TruckNow error', '/src/components/TruckNow.jsx', { position: null, hours: null, error: 'Incorrect login credentials' }],
  ['TruckNow asking', '/src/components/TruckNow.jsx', { position: null, hours: null }],

  // Invoicing: the run preview with a flagged customer and a straggler, the
  // AR list with every status and an overdue row, the aging strip, and the
  // document in its three states.
  ['InvoiceRunPreview', '/src/components/billing/InvoiceRunPreview.jsx', {
    plan: {
      invoiceDate: '2026-09-10', through: '2026-09-09',
      invoices: [
        { customerId: 1, name: 'Prairie Freight Partners', status: 'Active', termsDays: 15, dueDate: '2026-09-25', openBalance: 0, creditLimit: 40000,
          loads: [{ id: 'L-10416', lane: 'WATERLOO, IA - MINNEAPOLIS, MN', deliveredDate: '2026-09-09', referenceNo: 'PO-77', miles: 246, amount: 700 }],
          charges: [{ chargeId: 1, loadId: 'L-10416', code: 'DETENTION', description: 'DETENTION - 2 HRS', amount: 150, straggler: false },
            { chargeId: 4, loadId: 'L-30012', code: 'STOPOFF', description: 'STOP-OFF', amount: 75, straggler: true }],
          linehaul: 700, extras: 225, total: 925, stragglers: 1, onHold: false, overCredit: false },
        { customerId: 6, name: 'Riverbend Logistics LLC', status: 'Hold', termsDays: 45, dueDate: '2026-10-25', openBalance: 9500, creditLimit: 10000,
          loads: [{ id: 'L-10420', lane: 'CEDAR RAPIDS, IA - CHICAGO, IL', deliveredDate: '2026-09-08', referenceNo: null, miles: 224, amount: 660.8 }],
          charges: [], linehaul: 660.8, extras: 0, total: 660.8, stragglers: 0, onHold: true, overCredit: true },
      ],
      totals: { customers: 2, loads: 2, charges: 2, linehaul: 1360.8, extras: 225, total: 1585.8, flagged: 1 },
    },
    selected: new Set([1]), onToggle() {},
  }],
  ['InvoiceRunPreview empty', '/src/components/billing/InvoiceRunPreview.jsx', {
    plan: { invoiceDate: '2026-09-10', through: '2026-09-09', invoices: [], totals: { customers: 0, loads: 0, charges: 0, linehaul: 0, extras: 0, total: 0, flagged: 0 } },
    selected: new Set(), onToggle() {},
  }],
  ['InvoiceTable', '/src/components/billing/InvoiceTable.jsx', {
    invoices: [
      { invoiceNo: 'INV-260810-0003', customerId: 6, customerName: 'Riverbend Logistics LLC', customerStatus: 'Hold', invoiceDate: '2026-08-10', dueDate: '2026-09-24', status: 'Open', total: 2640, paidAmount: 0, paidDate: null, loadCount: 4, balance: 2640, daysPastDue: 0, bucket: 'current', overdue: false },
      { invoiceNo: 'INV-260803-0001', customerId: 1, customerName: 'Prairie Freight Partners', customerStatus: 'Active', invoiceDate: '2026-08-03', dueDate: '2026-08-18', status: 'Open', total: 1200, paidAmount: 500, paidDate: '2026-08-20', loadCount: 2, balance: 700, daysPastDue: 22, bucket: '1-30', overdue: true },
      { invoiceNo: 'INV-260803-0002', customerId: 2, customerName: 'Mississippi Valley Foods', customerStatus: 'Active', invoiceDate: '2026-08-03', dueDate: '2026-09-02', status: 'Paid', total: 3510, paidAmount: 3510, paidDate: '2026-08-30', loadCount: 6, balance: 0, daysPastDue: 0, bucket: null, overdue: false },
      { invoiceNo: 'INV-260901-0001', customerId: 1, customerName: 'Prairie Freight Partners', customerStatus: 'Active', invoiceDate: '2026-09-01', dueDate: '2026-09-16', status: 'Void', total: 585, paidAmount: 0, paidDate: null, loadCount: 1, balance: 0, daysPastDue: 0, bucket: null, overdue: false },
    ],
  }],
  ['InvoiceTable empty', '/src/components/billing/InvoiceTable.jsx', { invoices: [] }],
  ['AgingSummary', '/src/components/billing/InvoiceTable.jsx', {
    aging: { total: 3340, overdue: 700, count: 2, buckets: { current: 2640, '1-30': 700, '31-60': 0, '61-90': 0, '90+': 0 } },
  }, 'AgingSummary'],
  ['AgingSummary empty', '/src/components/billing/InvoiceTable.jsx', { aging: { total: 0, overdue: 0, count: 0, buckets: {} } }, 'AgingSummary'],
  ['InvoiceDocument open', '/src/components/billing/InvoiceDocument.jsx', {
    invoice: {
      invoiceNo: 'INV-260910-0001', customerId: 1, customerName: 'Prairie Freight Partners', invoiceDate: '2026-09-10', dueDate: '2026-09-25', termsDays: 15,
      billToName: 'Prairie Freight Partners', billToAddress: '8100 W Dodge Rd, Omaha, NE 68114', status: 'Open', total: 925, paidAmount: 0, paidDate: null, notes: null,
      customer: { contactName: 'Lupe Ortega', mcNumber: 'MC-655910' },
      lines: [
        { lineId: 1, loadId: 'L-10416', lineType: 'LINEHAUL', description: 'WATERLOO, IA - MINNEAPOLIS, MN', amount: 700, deliveredDate: '2026-09-09', referenceNo: 'PO-77', miles: 246 },
        { lineId: 2, loadId: 'L-10416', lineType: 'CHARGE', description: 'DETENTION - 2 HRS', amount: 150, deliveredDate: '2026-09-09', referenceNo: 'PO-77', miles: 246 },
        { lineId: 3, loadId: 'L-30012', lineType: 'CHARGE', description: 'STOP-OFF', amount: 75, deliveredDate: '2026-08-20', referenceNo: null, miles: 180 },
      ],
      // Three docks on the billed load, each with the consignee's own number,
      // and a POD signed at the last one. L-30012's stops carry nothing the
      // lane does not already say, so they must not print.
      stops: [
        { stopId: 21, loadId: 'L-10416', seq: 1, stopType: 'Pickup', place: 'Waterloo, IA', name: 'Tyson Foods', referenceNo: 'PU-4412', arrivedUtc: '2026-09-08T13:02:00', departedUtc: '2026-09-08T15:40:00' },
        { stopId: 22, loadId: 'L-10416', seq: 2, stopType: 'Delivery', place: 'Rochester, MN', name: 'Hy-Vee 1288', referenceNo: 'PO-99120', arrivedUtc: '2026-09-09T09:15:00', departedUtc: '2026-09-09T10:30:00' },
        { stopId: 23, loadId: 'L-10416', seq: 3, stopType: 'Delivery', place: 'Minneapolis, MN', name: 'Cub Foods DC', referenceNo: 'PO-99121', arrivedUtc: '2026-09-09T14:00:00', departedUtc: '2026-09-09T16:20:00' },
        { stopId: 31, loadId: 'L-30012', seq: 1, stopType: 'Pickup', place: 'Dubuque, IA', name: null, referenceNo: null, arrivedUtc: null, departedUtc: null },
        { stopId: 32, loadId: 'L-30012', seq: 2, stopType: 'Delivery', place: 'Chicago, IL', name: null, referenceNo: null, arrivedUtc: null, departedUtc: null },
      ],
      documents: [
        { documentId: 5, loadId: 'L-10416', stopId: 23, docType: 'POD', fileName: 'pod-cub-foods.pdf', uploadedUtc: '2026-09-09T17:04:00' },
        { documentId: 6, loadId: 'L-10416', stopId: null, docType: 'BOL', fileName: 'bol-L-10416.pdf', uploadedUtc: '2026-09-08T16:00:00' },
      ],
    },
  }],
  // The same document with the paper missing: no POD line under the totals,
  // and the dock rows still print because they carry reference numbers.
  ['InvoiceDocument no paper', '/src/components/billing/InvoiceDocument.jsx', {
    invoice: {
      invoiceNo: 'INV-260910-0002', invoiceDate: '2026-09-10', dueDate: '2026-09-25', termsDays: 15,
      billToName: 'Mississippi Valley Foods', billToAddress: null, status: 'Open', total: 700, paidAmount: 0, paidDate: null, notes: null, customer: null,
      lines: [{ lineId: 1, loadId: 'L-10420', lineType: 'LINEHAUL', description: 'AMES, IA - PEORIA, IL', amount: 700, deliveredDate: '2026-09-09', referenceNo: 'PO-31', miles: 312 }],
      stops: [
        { stopId: 41, loadId: 'L-10420', seq: 1, stopType: 'Pickup', place: 'Ames, IA', name: null, referenceNo: 'PU-9', arrivedUtc: null, departedUtc: null },
        { stopId: 42, loadId: 'L-10420', seq: 2, stopType: 'Delivery', place: 'Peoria, IL', name: null, referenceNo: 'PO-31', arrivedUtc: null, departedUtc: null },
      ],
      documents: [],
    },
  }],
  ['InvoiceDocument part paid', '/src/components/billing/InvoiceDocument.jsx', {
    invoice: {
      invoiceNo: 'INV-260803-0001', invoiceDate: '2026-08-03', dueDate: '2026-08-18', termsDays: 15, billToName: 'Prairie Freight Partners', billToAddress: null,
      status: 'Open', total: 1200, paidAmount: 500, paidDate: '2026-08-20', notes: 'Short paid; detention disputed.', customer: null,
      lines: [{ lineId: 1, loadId: 'L-30001', lineType: 'LINEHAUL', description: 'DUBUQUE, IA - CHICAGO, IL', amount: 1200, deliveredDate: '2026-08-01', referenceNo: null, miles: 182 }],
    },
  }],
  ['InvoiceDocument void', '/src/components/billing/InvoiceDocument.jsx', {
    invoice: {
      invoiceNo: 'INV-260901-0001', invoiceDate: '2026-09-01', dueDate: '2026-09-16', termsDays: 15, billToName: 'X', billToAddress: null,
      status: 'Void', total: 585, paidAmount: 0, paidDate: null, notes: 'Voided: wrong rate', customer: null,
      lines: [{ lineId: 1, loadId: 'L-1', lineType: 'LINEHAUL', description: 'A - B', amount: 585, deliveredDate: '2026-08-30', referenceNo: null, miles: null }],
    },
  }],
  ['Billing loading', '/src/pages/Billing.jsx', {}],
  ['Invoices loading', '/src/pages/Invoices.jsx', {}],
  ['Invoice loading', '/src/pages/Invoice.jsx', {}],
  ['LoadCard invoiced', '/src/components/LoadCard.jsx', {
    load: { id: 'L-30001', origin: 'Dubuque, IA', destination: 'Chicago, IL', miles: 182, rate: 585, equipment: 'Dry Van', status: 'Delivered', driverCode: 'JSMITH', unitNo: 'Demo - 15', deliveredDate: '2026-08-01', invoiceNo: 'INV-260803-0001', hazmat: false, tempF: null },
  }],
  ['LoadCharges billed', '/src/components/LoadCharges.jsx', {
    charges: [
      { chargeId: 1, lineType: 'REVENUE', code: 'DETENTION', description: 'DETENTION - 2 HRS', amount: 90, billCustomer: true, billAmount: 150, receiptNote: null, createdBy: 'd@x', createdUtc: '2026-09-09T14:00:00.000Z', paidOn: null, billedOn: { invoiceNo: 'INV-260910-0001', invoiceDate: '2026-09-10' } },
    ],
    canAdd: 'all', canRemove: true, async onAdd() {}, async onRemove() {},
  }],

  // The load map. A Map, not an object, because that is what useZones hands
  // the component. The states worth drawing: the ordinary one, the same map
  // with the geography behind it, the demo fleet's truck 1,500 miles away
  // (which must be described in words rather than drawn), a place GeoTab has
  // never heard of, and no places at all.
  ...(() => {
    const zonesByKey = new Map([
      ['WATERLOO, IA', { key: 'WATERLOO, IA', name: 'WATERLOO, IA', latitude: 42.4928, longitude: -92.3426 }],
      ['MINNEAPOLIS, MN', { key: 'MINNEAPOLIS, MN', name: 'MINNEAPOLIS, MN', latitude: 44.9778, longitude: -93.265 }],
      ['DUBUQUE, IA', { key: 'DUBUQUE, IA', name: 'DUBUQUE, IA', latitude: 42.5006, longitude: -90.6646 }],
      ['CHICAGO, IL', { key: 'CHICAGO, IL', name: 'CHICAGO, IL', latitude: 41.8781, longitude: -87.6298 }],
      ['DES MOINES, IA', { key: 'DES MOINES, IA', name: 'DES MOINES, IA', latitude: 41.5868, longitude: -93.625 }],
      ['MADISON, WI', { key: 'MADISON, WI', name: 'MADISON, WI', latitude: 43.0731, longitude: -89.4012 }],
    ])
    const stops = [
      { stopId: 21, seq: 1, stopType: 'Pickup', place: 'Waterloo, IA', departedUtc: '2026-09-08T15:40:00' },
      { stopId: 22, seq: 2, stopType: 'Delivery', place: 'Dubuque, IA', departedUtc: null },
      { stopId: 23, seq: 3, stopType: 'Delivery', place: 'Minneapolis, MN', departedUtc: null },
    ]
    const nearby = { unitNo: 'Demo - 15', latitude: 42.61, longitude: -91.35, near: 'Manchester, IA' }
    const vegas = { unitNo: 'Demo - 15', latitude: 36.0668, longitude: -115.0396, near: 'Henderson, NV' }
    return [
      ['LaneMap with truck', '/src/components/LaneMap.jsx', { stops, zonesByKey, truck: nearby }],
      // Effects do not run here, so the borders come in as a prop. This is
      // the state that would catch a generated file the path builder cannot
      // read -- the browser's version of it arrives a moment after the map.
      ['LaneMap with state borders', '/src/components/LaneMap.jsx', {
        stops, zonesByKey, truck: nearby, borders: STATE_BORDERS,
      }],
      // Streets on: the HERE basemap behind the pins. The prop forces it
      // because the real switch is a localStorage preference read in an
      // effect, and effects do not run here.
      ['LaneMap with streets', '/src/components/LaneMap.jsx', {
        stops, zonesByKey, truck: nearby, borders: STATE_BORDERS, streets: true,
      }],
      ['LaneMap truck far away', '/src/components/LaneMap.jsx', { stops, zonesByKey, truck: vegas }],
      ['LaneMap unknown place', '/src/components/LaneMap.jsx', {
        stops: [...stops, { stopId: 24, seq: 4, stopType: 'Delivery', place: 'Rockford, IL', departedUtc: null }],
        zonesByKey, truck: null,
      }],
      ['LaneMap no known places', '/src/components/LaneMap.jsx', {
        stops: [{ stopId: 1, seq: 1, stopType: 'Pickup', place: 'Nowhere, ZZ' }], zonesByKey, truck: null,
      }],
      ['LaneMap loading', '/src/components/LaneMap.jsx', { stops, zonesByKey: null, loading: true }],
      ['LaneMap not connected', '/src/components/LaneMap.jsx', { stops, zonesByKey: null, notConnected: true }],
    ]
  })(),

  // The ETA. Everything this component can be handed: the ordinary answer,
  // the same answer as a driver sees it in a card, a car route standing in
  // for a truck one, each of the server's refusals, and the states before
  // an answer exists at all.
  ...(() => {
    const legs = [
      {
        stopId: 2, seq: 2, stopType: 'Delivery', place: 'DUBUQUE, IA', dock: 'Mississippi Valley Foods',
        windowStart: '2026-09-15T13:00:00', windowEnd: '2026-09-15T15:00:00',
        eta: '2026-09-15T14:55:02', driveSeconds: 5910, miles: 92, cumulativeSeconds: 5910,
        timing: { state: 'inWindow', minutes: null },
      },
      {
        stopId: 3, seq: 3, stopType: 'Delivery', place: 'MINNEAPOLIS, MN', dock: null,
        windowStart: '2026-09-15T18:00:00', windowEnd: '2026-09-15T19:00:00',
        eta: '2026-09-15T19:55:08', driveSeconds: 18006, miles: 312, cumulativeSeconds: 23916,
        timing: { state: 'late', minutes: 55 },
      },
    ]
    const answer = {
      available: true, loadId: 'L-10416', unitNo: 'Demo - 15', mode: 'truck',
      from: { latitude: 42.61, longitude: -91.35, near: 'Manchester, IA', ageMinutes: 4 },
      legs, next: legs[0], last: legs[1], totalSeconds: 23916, totalMiles: 404, partial: false,
    }
    return [
      ['EtaPanel', '/src/components/EtaPanel.jsx', { eta: answer }],
      ['EtaPanel compact', '/src/components/EtaPanel.jsx', { eta: answer, compact: true }],
      ['EtaPanel car fallback', '/src/components/EtaPanel.jsx', { eta: { ...answer, mode: 'car', fellBack: true } }],
      ['EtaPanel too far', '/src/components/EtaPanel.jsx', { eta: {
        available: false, reason: 'too-far', unitNo: 'Demo - 15', near: 'Henderson, NV',
        message: 'The truck is too far from this load for an ETA to mean anything.',
      } }],
      ['EtaPanel not moving', '/src/components/EtaPanel.jsx', { eta: {
        available: false, reason: 'not-moving', message: 'An ETA is only worth having while a load is on the road.',
      } }],
      ['EtaPanel loading', '/src/components/EtaPanel.jsx', { loading: true }],
      ['EtaPanel not connected', '/src/components/EtaPanel.jsx', { notConnected: true }],
      ['EtaPanel error', '/src/components/EtaPanel.jsx', { error: 'Invalid credentials' }],
    ]
  })(),

  // Stops: the itinerary in every state a stop can be in (done, at the dock,
  // next, pending), as the driver sees it with a button and as an anonymous
  // visitor sees it with the dock nulled; the editor with a departed stop
  // locked; and the card drawing stops in place of shipper/consignee.
  ['StopList driver', '/src/components/StopList.jsx', {
    stops: [
      { stopId: 1, seq: 1, stopType: 'Pickup', place: 'Dubuque, IA', name: 'Mississippi Valley Foods', address: '1200 Kerper Blvd', phone: '563-555-0140', windowStart: '2026-09-10T08:00:00', windowEnd: '2026-09-10T12:00:00', referenceNo: 'PU-4471', notes: null, arrivedUtc: '2026-09-10T13:05:00', departedUtc: '2026-09-10T14:00:00' },
      { stopId: 2, seq: 2, stopType: 'Delivery', place: 'Rockford, IL', name: 'Jewel DC', address: null, phone: null, windowStart: '2026-09-10T15:00:00', windowEnd: null, referenceNo: null, notes: 'dock 14, call ahead', arrivedUtc: '2026-09-10T19:40:00', departedUtc: null },
      { stopId: 3, seq: 3, stopType: 'Delivery', place: 'Chicago, IL', name: 'Great Lakes Produce Co.', address: '4400 W 41st St', phone: null, windowStart: null, windowEnd: null, referenceNo: 'PO-9981', notes: null, arrivedUtc: null, departedUtc: null },
    ],
    progress: { total: 3, done: 1, currentSeq: 2, atDock: true, complete: false, current: { stopId: 2 } },
    onCheckIn() {},
  }],
  ['StopList anonymous', '/src/components/StopList.jsx', {
    stops: [
      { stopId: 1, seq: 1, stopType: 'Pickup', place: 'Dubuque, IA', name: null, address: null, phone: null, windowStart: '2026-09-10T08:00:00', windowEnd: null, referenceNo: null, notes: null, arrivedUtc: null, departedUtc: null },
      { stopId: 2, seq: 2, stopType: 'Delivery', place: 'Chicago, IL', name: null, address: null, phone: null, windowStart: null, windowEnd: null, referenceNo: null, notes: null, arrivedUtc: null, departedUtc: null },
    ],
  }],
  ['StopList empty', '/src/components/StopList.jsx', { stops: [] }],
  ['StopEditor', '/src/components/StopEditor.jsx', {
    stops: [
      { stopId: 1, stopType: 'Pickup', place: 'Dubuque, IA', name: 'Mississippi Valley Foods', address: '', phone: '', windowStart: '2026-09-10T08:00', windowEnd: '', referenceNo: '', notes: '', arrivedUtc: '2026-09-10T13:05:00', departedUtc: '2026-09-10T14:00:00' },
      { stopId: null, stopType: 'Delivery', place: '', name: '', address: '', phone: '', windowStart: '', windowEnd: '', referenceNo: '', notes: '', arrivedUtc: null, departedUtc: null },
      { stopId: 2, stopType: 'Delivery', place: 'Chicago, IL', name: '', address: '', phone: '', windowStart: '', windowEnd: '', referenceNo: 'PO-9981', notes: '', arrivedUtc: null, departedUtc: null },
    ],
    onChange() {},
  }],
  ['LoadCard with stops', '/src/components/LoadCard.jsx', {
    load: blankLoad({ status: 'In Transit', driverCode: 'JSMITH', unitNo: 'Demo - 15', customerName: 'Mississippi Valley Foods', customerId: 2, stopCount: 3 }),
    stops: [
      { stopId: 1, seq: 1, stopType: 'Pickup', place: 'Dubuque, IA', name: 'Mississippi Valley Foods', address: null, phone: null, windowStart: null, windowEnd: null, referenceNo: null, notes: null, arrivedUtc: '2026-09-10T13:05:00', departedUtc: '2026-09-10T14:00:00' },
      { stopId: 2, seq: 2, stopType: 'Delivery', place: 'Rockford, IL', name: null, address: null, phone: null, windowStart: null, windowEnd: null, referenceNo: null, notes: null, arrivedUtc: null, departedUtc: null },
      { stopId: 3, seq: 3, stopType: 'Delivery', place: 'Chicago, IL', name: null, address: null, phone: null, windowStart: null, windowEnd: null, referenceNo: null, notes: null, arrivedUtc: null, departedUtc: null },
    ],
    stopsProgress: { total: 3, done: 1, currentSeq: 2, atDock: false, complete: false, current: { stopId: 2 } },
    onCheckIn() {},
  }],
  ['LoadRow multi-stop', '/src/components/LoadTable.jsx', {
    loads: [blankLoad({ id: 'L-10430', stopCount: 3 }), blankLoad({ id: 'L-10431', stopCount: 2 })],
  }],

  // Documents: the list with every kind of paper and a remove button, the
  // empty state with the attach button, read-only, and not connected.
  ['LoadDocuments', '/src/components/LoadDocuments.jsx', {
    documents: [
      { documentId: 1, loadId: 'L-10416', stopId: 3, stopSeq: 3, stopPlace: 'Chicago, IL', docType: 'POD', docTypeLabel: 'Proof of delivery', fileName: 'IMG_0412.jpg', contentType: 'image/jpeg', sizeBytes: 2_400_000, notes: 'signed by receiver', uploadedUtc: '2026-09-10T19:40:00', uploadedBy: 'jsmith@example.invalid', viewUrl: 'https://example.invalid/blob?sig=x' },
      { documentId: 2, loadId: 'L-10416', stopId: null, stopSeq: null, stopPlace: null, docType: 'RATECON', docTypeLabel: 'Rate confirmation', fileName: 'ratecon-4471.pdf', contentType: 'application/pdf', sizeBytes: 90_000, notes: null, uploadedUtc: '2026-09-09T14:00:00', uploadedBy: 'dispatch@millstream.example', viewUrl: null },
    ],
    stops: [{ stopId: 1, seq: 1, stopType: 'Pickup', place: 'Waterloo, IA' }, { stopId: 3, seq: 3, stopType: 'Delivery', place: 'Chicago, IL' }],
    canUpload: true, canRemove: () => true, async onUpload() {}, async onRemove() {},
  }],
  ['LoadDocuments empty', '/src/components/LoadDocuments.jsx', {
    documents: [], stops: [], canUpload: true, canRemove: () => false, async onUpload() {}, async onRemove() {},
  }],
  ['LoadDocuments read-only', '/src/components/LoadDocuments.jsx', {
    documents: [], stops: [], canUpload: false, canRemove: () => false, async onUpload() {}, async onRemove() {},
  }],
  ['LoadDocuments not connected', '/src/components/LoadDocuments.jsx', {
    documents: [], notConnected: true, async onUpload() {}, async onRemove() {},
  }],

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

for (const [label, path, props, exportName] of cases) {
  try {
    const mod = await vite.ssrLoadModule(path)
    // A fourth element names a named export; otherwise the default.
    const Component = exportName ? mod[exportName] : mod.default

    // Wrapped in a router because the settlement components render <Link>,
    // which throws outside one. MemoryRouter keeps its history in memory
    // rather than touching window.history, which is what makes it the one
    // that works under a server renderer. It adds no markup of its own, so
    // the components that do not need it are unaffected.
    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(Component, props))
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
