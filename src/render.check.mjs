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
