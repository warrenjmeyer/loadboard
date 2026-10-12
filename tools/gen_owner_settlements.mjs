// Generates settlement_06_owner.sql.
//
// Hand-keying twelve settlements is how a seed file ends up with totals that
// disagree with their own detail, so every figure below is computed: route pay
// from miles x rate (or revenue x share), the escrow chain from its own
// transactions, and the total in each comment from the lines above it.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const money = (n) => round2(n).toFixed(2)

// --------------------------------------------------------------------------
// Drivers. Two paid by the mile, two paid a share of the linehaul, because the
// statement renders those two differently and both paths want real data.
// --------------------------------------------------------------------------
const DRIVERS = [
  {
    code: 'RVASQUEZ', first: 'Rey', last: 'Vasquez', basis: 'MILEAGE',
    rate: 1.88, unit: 'Demo - 21', ssn: '3308',
    addr: '418 Sycamore Street', city: 'Cedar Rapids', state: 'IA', zip: '52401',
    truck: '2021 Freightliner Cascadia',
  },
  {
    code: 'KBRENNAN', first: 'Kit', last: 'Brennan', basis: 'MILEAGE',
    rate: 1.82, unit: 'Demo - 22', ssn: '7742',
    addr: '2205 Asbury Road', city: 'Dubuque', state: 'IA', zip: '52001',
    truck: '2020 Peterbilt 579',
  },
  {
    code: 'MOKONKWO', first: 'Miriam', last: 'Okonkwo', basis: 'PERCENTAGE',
    rate: 0.68, unit: 'Demo - 23', ssn: '5164',
    addr: '937 Brady Street', city: 'Davenport', state: 'IA', zip: '52803',
    truck: '2022 Kenworth T680',
  },
  {
    code: 'LSTAVROS', first: 'Lark', last: 'Stavros', basis: 'PERCENTAGE',
    rate: 0.72, unit: 'Demo - 24', ssn: '9081',
    addr: '1640 Kimball Avenue', city: 'Waterloo', state: 'IA', zip: '50702',
    truck: '2021 Volvo VNL 860',
  },
]

const PERIODS = [
  { check: '2026-08-14', start: '2026-08-02', end: '2026-08-08', delivered: ['2026-08-04', '2026-08-05', '2026-08-07', '2026-08-08'] },
  { check: '2026-08-21', start: '2026-08-09', end: '2026-08-15', delivered: ['2026-08-10', '2026-08-12', '2026-08-13', '2026-08-15'] },
  { check: '2026-08-28', start: '2026-08-16', end: '2026-08-22', delivered: ['2026-08-17', '2026-08-19', '2026-08-20', '2026-08-22'] },
]

// Lanes: [origin, destination, loadedMiles, emptyMiles, equipment, dollarsPerMile
// billed to the customer]. The carrier rate is what a percentage driver takes a
// share of, and it is deliberately nowhere near the driver's own rate -- equal
// figures would be the tell that the data is invented.
const LANES = [
  ['Cedar Rapids, IA', 'Chicago, IL', 224, 31, 'Dry Van', 2.95],
  ['Chicago, IL', 'Detroit, MI', 283, 22, 'Reefer', 3.05],
  ['Detroit, MI', 'Columbus, OH', 204, 18, 'Dry Van', 2.90],
  ['Columbus, OH', 'Cedar Rapids, IA', 618, 27, 'Flatbed', 2.80],
  ['Dubuque, IA', 'Minneapolis, MN', 246, 24, 'Reefer', 3.00],
  ['Minneapolis, MN', 'Fargo, ND', 240, 19, 'Dry Van', 2.85],
  ['Fargo, ND', 'Sioux Falls, SD', 242, 26, 'Flatbed', 2.75],
  ['Sioux Falls, SD', 'Dubuque, IA', 396, 33, 'Dry Van', 2.90],
  ['Davenport, IA', 'Indianapolis, IN', 331, 28, 'Reefer', 3.10],
  ['Indianapolis, IN', 'Louisville, KY', 114, 15, 'Dry Van', 3.20],
  ['Louisville, KY', 'Nashville, TN', 175, 21, 'Flatbed', 2.95],
  ['Nashville, TN', 'Davenport, IA', 619, 35, 'Reefer', 2.85],
  ['Waterloo, IA', 'Kansas City, MO', 297, 26, 'Dry Van', 2.90],
  ['Kansas City, MO', 'Wichita, KS', 199, 17, 'Flatbed', 2.80],
  ['Wichita, KS', 'Oklahoma City, OK', 158, 20, 'Dry Van', 2.95],
  ['Oklahoma City, OK', 'Waterloo, IA', 663, 38, 'Reefer', 2.75],
  ['Cedar Rapids, IA', 'St. Louis, MO', 340, 29, 'Flatbed', 2.90],
  ['St. Louis, MO', 'Memphis, TN', 284, 23, 'Dry Van', 3.00],
  ['Memphis, TN', 'Little Rock, AR', 137, 16, 'Reefer', 3.15],
  ['Little Rock, AR', 'Cedar Rapids, IA', 612, 31, 'Dry Van', 2.80],
  ['Dubuque, IA', 'Milwaukee, WI', 178, 20, 'Dry Van', 3.05],
  ['Milwaukee, WI', 'Grand Rapids, MI', 289, 25, 'Reefer', 2.95],
  ['Grand Rapids, MI', 'Toledo, OH', 176, 18, 'Flatbed', 2.90],
  ['Toledo, OH', 'Dubuque, IA', 458, 30, 'Dry Van', 2.85],
  ['Davenport, IA', 'Omaha, NE', 297, 27, 'Reefer', 2.90],
  ['Omaha, NE', 'Des Moines, IA', 135, 14, 'Dry Van', 3.10],
  ['Des Moines, IA', 'Springfield, MO', 305, 24, 'Flatbed', 2.85],
  ['Springfield, MO', 'Davenport, IA', 425, 29, 'Dry Van', 2.80],
  ['Waterloo, IA', 'Madison, WI', 216, 22, 'Reefer', 3.00],
  ['Madison, WI', 'Peoria, IL', 232, 19, 'Dry Van', 2.90],
  ['Peoria, IL', 'Fort Wayne, IN', 251, 21, 'Flatbed', 2.95],
  ['Fort Wayne, IN', 'Waterloo, IA', 447, 28, 'Dry Van', 2.85],
  ['Cedar Rapids, IA', 'Denver, CO', 892, 41, 'Reefer', 2.70],
  ['Denver, CO', 'Salt Lake City, UT', 525, 33, 'Dry Van', 2.75],
  ['Salt Lake City, UT', 'Boise, ID', 340, 26, 'Flatbed', 2.85],
  ['Boise, ID', 'Cedar Rapids, IA', 1421, 47, 'Dry Van', 2.60],
  ['Dubuque, IA', 'Pittsburgh, PA', 668, 36, 'Dry Van', 2.80],
  ['Pittsburgh, PA', 'Buffalo, NY', 219, 20, 'Reefer', 3.00],
  ['Buffalo, NY', 'Cleveland, OH', 191, 17, 'Flatbed', 2.95],
  ['Cleveland, OH', 'Dubuque, IA', 570, 32, 'Dry Van', 2.85],
  ['Davenport, IA', 'Dallas, TX', 830, 39, 'Reefer', 2.75],
  ['Dallas, TX', 'Houston, TX', 239, 22, 'Dry Van', 3.05],
  ['Houston, TX', 'New Orleans, LA', 348, 25, 'Flatbed', 2.90],
  ['New Orleans, LA', 'Davenport, IA', 936, 42, 'Dry Van', 2.70],
  ['Waterloo, IA', 'Atlanta, GA', 812, 37, 'Dry Van', 2.80],
  ['Atlanta, GA', 'Charlotte, NC', 245, 21, 'Reefer', 3.00],
  ['Charlotte, NC', 'Nashville, TN', 409, 27, 'Flatbed', 2.85],
  ['Nashville, TN', 'Waterloo, IA', 619, 34, 'Dry Van', 2.80],
]

// Non-mileage compensation. Fuel surcharge is the big one for an owner
// /operator -- it is the offset to the fuel they buy themselves, and a
// statement without it looks like the driver is losing money on every load.
const REVENUE_BY_WEEK = [
  [['FUEL SURCHARGE', 412.6], ['DETENTION - 2 HRS', 90.0]],
  [['FUEL SURCHARGE', 468.25], ['STOP OFF PAY', 75.0], ['LAYOVER', 150.0]],
  [['FUEL SURCHARGE', 501.4], ['DETENTION - 3 HRS', 135.0]],
]

const REIMBURSE_BY_WEEK = [
  [['TOLLS', 64.3, 1], ['SCALE', 22.0, 2]],
  [['TOLLS', 48.75, 0], ['LUMPER', 125.0, 2], ['SCALE', 11.0, 3]],
  [['TOLLS', 71.2, 1], ['WASH OUT', 45.0, 3]],
]

// Roughly 6.5 mpg at $3.85 a gallon. Fuel is derived from the week's miles
// rather than set as a flat figure, because it is the one deduction that
// genuinely tracks how far the truck went -- and a fixed weekly number makes a
// short week look like the driver took home almost nothing.
const FUEL_PER_MILE = 0.592

// Weekly deductions. This is where an owner/operator statement diverges most
// from a company driver's: the truck, its insurance and its fuel all come out
// of the settlement, and none of it is tax -- a 1099 contractor has nothing
// withheld.
const deductionsFor = (d, week, totalMiles) => {
  const lines = [
    ['FUEL - COMCHEK', null, -round2(totalMiles * FUEL_PER_MILE)],
    ['TRUCK PAYMENT', null, -712.0],
    ['OCC/ACC INSURANCE', null, -68.5],
    ['PHYSICAL DAMAGE INS', null, -94.25],
    ['TRAILER RENT', null, -175.0],
    ['ELD SUBSCRIPTION', null, -32.0],
  ]
  if (week === 1) lines.push(['ADVANCE', `CD-9${d.ssn}`, -300.0])
  return lines
}

// Escrow. Two accounts per driver, each taking a fixed weekly contribution, so
// the balance chain is arithmetic rather than three unrelated numbers -- which
// is all the original page ever printed.
const ESCROW = [
  { code: 'MAINT', label: 'MAINTENANCE', description: 'Maintenance Escrow', opening: 2400.0, weekly: 125.0 },
  { code: 'TIRE', label: 'TIRE', description: 'Tire Escrow', opening: 860.0, weekly: 75.0 },
]

// --------------------------------------------------------------------------

const out = []
const w = (s = '') => out.push(s)

w(`-- settlement_06_owner.sql`)
w(`-- Owner/operator settlements: the port of ownDrvSettlement.cfm.`)
w(`--`)
w(`-- An owner/operator is a 1099 contractor who owns the truck. The money moves`)
w(`-- differently enough from a company driver that the statement is a different`)
w(`-- document: fuel, the truck payment and its insurance all come OUT of the`)
w(`-- settlement, nothing is withheld for tax, and the driver is carrying escrow`)
w(`-- balances the carrier holds on their behalf. What is the same -- earnings by`)
w(`-- load, revenue and deduction lines -- reuses the existing tables rather than`)
w(`-- getting parallel ones, because the original's separate OWNER_OPERATOR_*`)
w(`-- tables held the same columns as the company ones under different names.`)
w(`--`)
w(`-- Three things this file adds to the schema:`)
w(`--   1. dbo.Drivers.driver_type    -- COMPANY or OWNER, the discriminator`)
w(`--   2. dbo.Drivers.pay_basis      -- MILEAGE or PERCENTAGE, owners only`)
w(`--   3. dbo.SettlementEscrow       -- the escrow/loan balances`)
w(`--`)
w(`-- Generated, not hand-written: route pay is miles x rate (or linehaul revenue`)
w(`-- x share) to the cent, and each escrow row's ending balance is its own`)
w(`-- beginning plus its own transaction -- enforced by a CHECK, because three`)
w(`-- unrelated numbers in three columns is exactly what the original printed.`)
w(`--`)
w(`--   DO NOT EDIT THIS FILE BY HAND.`)
w(`--   tools/gen_owner_settlements.mjs is the source; regenerate with`)
w(`--       node tools/gen_owner_settlements.mjs > sql/settlement_06_owner.sql`)
w(`--   A figure changed here and not there is one the arithmetic no longer`)
w(`--   guarantees, which is the whole reason the file is generated.`)
w(`--`)
w(`-- Re-runnable. Requires settlement_01_ddl.sql and settlement_05_link.sql.`)
w()
w(`SET NOCOUNT ON;`)
w(`GO`)
w()

// ---- schema -------------------------------------------------------------
w(`------------------------------------------------------------------------------`)
w(`-- Schema: the owner/operator discriminator`)
w(`------------------------------------------------------------------------------`)
w()
w(`-- NOT NULL with a default of COMPANY. Every driver already in the table is a`)
w(`-- company driver, and leaving the column nullable would mean every query`)
w(`-- downstream has to decide what NULL means.`)
w(`IF COL_LENGTH(N'dbo.Drivers', N'driver_type') IS NULL`)
w(`BEGIN`)
w(`    ALTER TABLE dbo.Drivers ADD driver_type VARCHAR(10) NOT NULL`)
w(`        CONSTRAINT DF_Drivers_type DEFAULT 'COMPANY';`)
w(`END`)
w(`GO`)
w()
w(`-- How an owner/operator is paid: by the mile, or as a share of what the load`)
w(`-- billed. NULL for a company driver -- the question does not apply to them,`)
w(`-- and a default of MILEAGE would be a fact nobody asserted.`)
w(`IF COL_LENGTH(N'dbo.Drivers', N'pay_basis') IS NULL`)
w(`BEGIN`)
w(`    ALTER TABLE dbo.Drivers ADD pay_basis VARCHAR(12) NULL;`)
w(`END`)
w(`GO`)
w()
w(`IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Drivers_type')`)
w(`BEGIN`)
w(`    ALTER TABLE dbo.Drivers ADD CONSTRAINT CK_Drivers_type`)
w(`        CHECK (driver_type IN ('COMPANY', 'OWNER'));`)
w(`END`)
w(`GO`)
w()
w(`-- An owner has a pay basis and a company driver does not. Stating it here`)
w(`-- means the front end can branch on driver_type alone and trust that`)
w(`-- pay_basis is there when it needs it.`)
w(`IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Drivers_paybasis')`)
w(`BEGIN`)
w(`    ALTER TABLE dbo.Drivers ADD CONSTRAINT CK_Drivers_paybasis CHECK (`)
w(`        (driver_type = 'OWNER'   AND pay_basis IN ('MILEAGE', 'PERCENTAGE'))`)
w(`        OR`)
w(`        (driver_type = 'COMPANY' AND pay_basis IS NULL)`)
w(`    );`)
w(`END`)
w(`GO`)
w()
w(`-- The truck. A company driver is assigned whatever is in the yard; an owner`)
w(`-- /operator's statement names the specific vehicle, because it is theirs and`)
w(`-- the truck payment on the deduction side is for this one.`)
w(`IF COL_LENGTH(N'dbo.Drivers', N'unit_no') IS NULL`)
w(`BEGIN`)
w(`    ALTER TABLE dbo.Drivers ADD unit_no VARCHAR(20) NULL;`)
w(`END`)
w(`GO`)
w()
w(`IF COL_LENGTH(N'dbo.Drivers', N'truck_description') IS NULL`)
w(`BEGIN`)
w(`    ALTER TABLE dbo.Drivers ADD truck_description NVARCHAR(80) NULL;`)
w(`END`)
w(`GO`)
w()
w(`-- What the load billed the customer. A percentage driver's pay is a share of`)
w(`-- this, so without it their pay_amount is a number nobody can check. NULL for`)
w(`-- a mileage line, where miles x rate is already the whole story.`)
w(`IF COL_LENGTH(N'dbo.SettlementRoutes', N'linehaul_revenue') IS NULL`)
w(`BEGIN`)
w(`    ALTER TABLE dbo.SettlementRoutes ADD linehaul_revenue DECIMAL(12,2) NULL;`)
w(`END`)
w(`GO`)
w()
w(`IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Routes_linehaul')`)
w(`BEGIN`)
w(`    ALTER TABLE dbo.SettlementRoutes ADD CONSTRAINT CK_Routes_linehaul`)
w(`        CHECK (linehaul_revenue IS NULL OR linehaul_revenue >= 0);`)
w(`END`)
w(`GO`)
w()
w(`------------------------------------------------------------------------------`)
w(`-- Escrow / loan balances`)
w(`--`)
w(`-- One row per account per settlement -- a running statement of an account the`)
w(`-- carrier holds on the driver's behalf, not a balance the driver can spend.`)
w(`--`)
w(`-- The CHECK is the point of the table. The original printed BEGINNING_BALANCE,`)
w(`-- TRANSACTION_AMOUNT and CURRENT_BALANCE as three independent columns with`)
w(`-- nothing tying them together, so a bad feed showed a driver an ending balance`)
w(`-- that did not follow from the change above it. Here that row cannot be`)
w(`-- written.`)
w(`------------------------------------------------------------------------------`)
w(`IF OBJECT_ID(N'dbo.SettlementEscrow', N'U') IS NULL`)
w(`BEGIN`)
w(`    CREATE TABLE dbo.SettlementEscrow (`)
w(`        escrow_id          INT IDENTITY(1,1) NOT NULL,`)
w(`        settlement_id      INT           NOT NULL,`)
w(`        escrow_code        VARCHAR(20)   NOT NULL,`)
w(`        description        NVARCHAR(120) NOT NULL,`)
w()
w(`        beginning_balance  DECIMAL(12,2) NOT NULL,`)
w(`        -- Signed the way it moves the balance: a contribution is positive, a`)
w(`        -- refund or a repair drawn against the account is negative.`)
w(`        transaction_amount DECIMAL(12,2) NOT NULL,`)
w(`        current_balance    DECIMAL(12,2) NOT NULL,`)
w()
w(`        CONSTRAINT PK_SettlementEscrow PRIMARY KEY (escrow_id),`)
w(`        CONSTRAINT FK_Escrow_settlement FOREIGN KEY (settlement_id)`)
w(`            REFERENCES dbo.Settlements (settlement_id) ON DELETE CASCADE,`)
w(`        -- One row per account per settlement. Two would mean two ending`)
w(`        -- balances for the same account on the same day.`)
w(`        CONSTRAINT UQ_Escrow_settlement_code UNIQUE (settlement_id, escrow_code),`)
w(`        CONSTRAINT CK_Escrow_chain`)
w(`            CHECK (current_balance = beginning_balance + transaction_amount)`)
w(`    );`)
w()
w(`    CREATE INDEX IX_Escrow_settlement ON dbo.SettlementEscrow (settlement_id);`)
w(`END`)
w(`GO`)
w()

const codes = DRIVERS.map((d) => `'${d.code}'`).join(', ')
w(`------------------------------------------------------------------------------`)
w(`-- Data`)
w(`--`)
w(`-- Delete first so the file is re-runnable. Routes, lines and escrow all`)
w(`-- cascade from dbo.Settlements; the loads go separately because they are`)
w(`-- referenced BY the routes, not owned by them.`)
w(`--`)
w(`-- ORDER MATTERS, and not in the obvious direction: the DRIVERS go in before`)
w(`-- the loads. FK_Loads_driver points dbo.Loads.driver_code at dbo.Drivers, so`)
w(`-- a load delivered by RVASQUEZ cannot be written until RVASQUEZ exists.`)
w(`-- Settlements come last, because their routes reference both.`)
w(`------------------------------------------------------------------------------`)
w(`DELETE FROM dbo.Settlements WHERE driver_code IN (${codes});`)
w(`GO`)
w()

// ---- drivers ------------------------------------------------------------
w(`------------------------------------------------------------------------------`)
w(`-- The four owner/operators`)
w(`--`)
w(`-- pay_rate carries two different units, which the pay_basis column is what`)
w(`-- makes readable: dollars per mile for the mileage drivers, a fraction of the`)
w(`-- linehaul for the percentage ones. 0.6800 is 68% of the load, not 68 cents a`)
w(`-- mile, and nothing but pay_basis says so.`)
w(`------------------------------------------------------------------------------`)
w(`MERGE dbo.Drivers AS target`)
w(`USING (VALUES`)
w(
  DRIVERS.map(
    (d) =>
      `    ('${d.code}', N'${d.first}', N'${d.last}', N'${d.addr}', NULL, N'${d.city}', N'${d.state}', '${d.zip}', '${d.ssn}',\n` +
      `     N'Owner Operator', ${d.rate.toFixed(4)}, 'W', N'HMLOO', N'${d.city}, ${d.state}', N'Linehaul', N'Owner Operator',\n` +
      `     'OWNER', '${d.basis}', N'${d.unit}', N'${d.truck}')`
  ).join(',\n')
)
w(`) AS source (driver_code, first_name, last_name, address1, address2, city, state, postal_code,`)
w(`             ssn_last4, job, pay_rate, pay_frequency, pay_group, location, department, job_type,`)
w(`             driver_type, pay_basis, unit_no, truck_description)`)
w(`ON target.driver_code = source.driver_code`)
w(`WHEN MATCHED THEN UPDATE SET`)
w(`    first_name = source.first_name, last_name = source.last_name,`)
w(`    address1 = source.address1, address2 = source.address2, city = source.city,`)
w(`    state = source.state, postal_code = source.postal_code, ssn_last4 = source.ssn_last4,`)
w(`    job = source.job, pay_rate = source.pay_rate, pay_frequency = source.pay_frequency,`)
w(`    pay_group = source.pay_group, location = source.location,`)
w(`    department = source.department, job_type = source.job_type,`)
w(`    driver_type = source.driver_type, pay_basis = source.pay_basis,`)
w(`    unit_no = source.unit_no, truck_description = source.truck_description`)
w(`WHEN NOT MATCHED THEN INSERT (driver_code, first_name, last_name, address1, address2, city, state,`)
w(`    postal_code, ssn_last4, job, pay_rate, pay_frequency, pay_group, location, department, job_type,`)
w(`    driver_type, pay_basis, unit_no, truck_description)`)
w(`VALUES (source.driver_code, source.first_name, source.last_name, source.address1, source.address2,`)
w(`    source.city, source.state, source.postal_code, source.ssn_last4, source.job, source.pay_rate,`)
w(`    source.pay_frequency, source.pay_group, source.location, source.department, source.job_type,`)
w(`    source.driver_type, source.pay_basis, source.unit_no, source.truck_description);`)
w(`GO`)
w()

// ---- loads --------------------------------------------------------------
// Build every load first: routes reference them by FK.
let loadSeq = 31000
const plan = []

DRIVERS.forEach((d, di) => {
  PERIODS.forEach((p, wi) => {
    const legs = []
    for (let i = 0; i < 4; i++) {
      const lane = LANES[(di * 12 + wi * 4 + i) % LANES.length]
      const [origin, destination, loaded, empty, equipment, billRate] = lane
      loadSeq += 1
      const id = `L-${loadSeq}`
      const total = loaded + empty
      const revenue = round2(loaded * billRate)
      const pay =
        d.basis === 'MILEAGE' ? round2(total * d.rate) : round2(revenue * d.rate)
      legs.push({
        id, origin, destination, loaded, empty, total, equipment,
        revenue, pay, delivered: p.delivered[i],
        orderNo: `O-2${loadSeq - 30000}`,
        dispatchNo: `D-5${loadSeq - 30000}`,
        routeDetail: `${origin.toUpperCase()} - ${destination.toUpperCase()}`,
      })
    }
    plan.push({ driver: d, period: p, week: wi, legs })
  })
})

w(`------------------------------------------------------------------------------`)
w(`-- The freight behind these settlements`)
w(`--`)
w(`-- The rate is the CARRIER's revenue -- what the customer was billed. For the`)
w(`-- two percentage drivers it is also the number their pay is a share of, which`)
w(`-- is why a line on their statement can be checked against the load board.`)
w(`------------------------------------------------------------------------------`)
w(`MERGE dbo.Loads AS target`)
w(`USING (VALUES`)
const loadRows = []
plan.forEach((s) => {
  s.legs.forEach((l) => {
    loadRows.push(
      `    ('${l.id}', N'${l.origin}', N'${l.destination}', ${String(l.loaded).padStart(4)}, ${money(l.revenue).padStart(7)}, N'${l.equipment}', N'Delivered', '${s.driver.code}', '${l.delivered}')`
    )
  })
})
w(loadRows.join(',\n'))
w(`) AS source (id, origin, destination, miles, rate, equipment, status, driver_code, delivered_date)`)
w(`ON target.id = source.id`)
w(`WHEN MATCHED THEN UPDATE SET`)
w(`    origin = source.origin, destination = source.destination, miles = source.miles,`)
w(`    rate = source.rate, equipment = source.equipment, status = source.status,`)
w(`    driver_code = source.driver_code, delivered_date = source.delivered_date`)
w(`WHEN NOT MATCHED THEN INSERT (id, origin, destination, miles, rate, equipment, status, driver_code, delivered_date)`)
w(`VALUES (source.id, source.origin, source.destination, source.miles, source.rate,`)
w(`    source.equipment, source.status, source.driver_code, source.delivered_date);`)
w(`GO`)
w()

// ---- settlements --------------------------------------------------------
w(`DECLARE @sid INT;`)
w()

// Escrow balances carry across weeks per driver.
const escrowBalance = {}
DRIVERS.forEach((d) => {
  escrowBalance[d.code] = {}
  ESCROW.forEach((e) => {
    escrowBalance[d.code][e.code] = e.opening
  })
})

let docSeq = 0
plan.forEach((s) => {
  const d = s.driver
  const p = s.period
  docSeq += 1
  const doc = `CK-${p.check.slice(2).replace(/-/g, '')}-${String(2000 + docSeq).padStart(4, '0')}`

  const routePay = round2(s.legs.reduce((t, l) => t + l.pay, 0))
  const revenue = REVENUE_BY_WEEK[s.week]
  const revenueTotal = round2(revenue.reduce((t, r) => t + r[1], 0))
  const reimburse = REIMBURSE_BY_WEEK[s.week]
  const reimburseTotal = round2(reimburse.reduce((t, r) => t + r[1], 0))
  const weekMiles = s.legs.reduce((t, l) => t + l.total, 0)
  const deductions = deductionsFor(d, s.week, weekMiles)

  // The escrow contributions are deductions too -- the money leaves the
  // settlement. Adding them here keeps one source of truth for the figure.
  const escrowLines = ESCROW.map((e) => [`ESCROW - ${e.label}`, null, -e.weekly])
  const allDeductions = [...deductions, ...escrowLines]
  const deductionTotal = round2(allDeductions.reduce((t, x) => t + x[2], 0))

  const total = round2(routePay + revenueTotal + reimburseTotal + deductionTotal)

  w(`------------------------------------------------------------------------------`)
  w(`-- ${d.first.toUpperCase()} ${d.last.toUpperCase()} (${d.basis === 'MILEAGE' ? 'mileage' : 'percentage'}) -- week ending ${p.end.slice(5).replace('-', '/')}, paid ${p.check.slice(5).replace('-', '/')}`)
  w(`------------------------------------------------------------------------------`)
  w(`INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)`)
  w(`VALUES ('${d.code}', '${p.check}', '${p.start}', '${p.end}', '${doc}');`)
  w(`SET @sid = SCOPE_IDENTITY();`)
  w()
  w(`INSERT INTO dbo.SettlementRoutes`)
  w(`    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, linehaul_revenue, pay_rate, pay_amount)`)
  w(`VALUES`)
  const wRoute = Math.max(...s.legs.map((l) => l.routeDetail.length)) + 4
  w(
    s.legs
      .map(
        (l) =>
          `    (@sid, '${l.orderNo}', '${l.id}', '${l.dispatchNo}', '${d.unit}', ` +
          `${`N'${l.routeDetail}',`.padEnd(wRoute)} ${String(l.loaded).padStart(4)}, ${String(l.empty).padStart(3)}, ${String(l.total).padStart(4)}, ` +
          `${d.basis === 'PERCENTAGE' ? money(l.revenue).padStart(8) : '    NULL'}, ${d.rate.toFixed(4)}, ${money(l.pay).padStart(8)})`
      )
      .join(',\n') + ';'
  )
  w()
  w(`INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)`)
  w(`VALUES`)
  // Build the line rows as columns first, then pad each column to its widest
  // value. Aligning by hand is how a seed file ends up looking ragged the one
  // time a description runs long.
  const cells = []
  revenue.forEach(([desc, amt]) => cells.push(['REVENUE', 'NULL', desc, 'NULL', amt]))
  reimburse.forEach(([desc, amt, legIdx]) =>
    cells.push(['REIMBURSEMENT', `'${s.legs[legIdx].orderNo}'`, desc, 'NULL', amt])
  )
  allDeductions.forEach(([desc, ref, amt]) =>
    cells.push(['DEDUCTION', 'NULL', desc, ref ? `N'${ref}'` : 'NULL', amt])
  )

  // Each token carries its own trailing comma before it is padded, so the
  // commas line up in a column instead of drifting with the value.
  const tokens = cells.map((c) => [
    `'${c[0]}',`,
    `${c[1]},`,
    `N'${c[2]}',`,
    `${c[3]},`,
    money(c[4]),
  ])
  const width = (i) => Math.max(...tokens.map((t) => t[i].length))
  const wType = width(0)
  const wOrder = width(1)
  const wDesc = width(2)
  const wRef = width(3)

  w(
    tokens
      .map(
        (t) =>
          `    (@sid, ${t[0].padEnd(wType)} ${t[1].padEnd(wOrder)} NULL, ` +
          `${t[2].padEnd(wDesc)} ${t[3].padEnd(wRef)} ${t[4].padStart(9)})`
      )
      .join(',\n') + ';'
  )
  w()
  w(`INSERT INTO dbo.SettlementEscrow (settlement_id, escrow_code, description, beginning_balance, transaction_amount, current_balance)`)
  w(`VALUES`)
  w(
    ESCROW.map((e) => {
      const begin = escrowBalance[d.code][e.code]
      const end = round2(begin + e.weekly)
      escrowBalance[d.code][e.code] = end
      const code = `'${e.code}',`.padEnd(Math.max(...ESCROW.map((x) => x.code.length + 3)))
      const desc = `N'${e.description}',`.padEnd(
        Math.max(...ESCROW.map((x) => x.description.length + 4))
      )
      return `    (@sid, ${code} ${desc} ${money(begin).padStart(8)}, ${money(e.weekly).padStart(7)}, ${money(end).padStart(8)})`
    }).join(',\n') + ';'
  )
  w(
    `-- Settlement total: ${money(routePay)} + ${money(revenueTotal)} + ${money(reimburseTotal)} - ${money(Math.abs(deductionTotal))} = ${money(total)}`
  )
  w()
})

// ---- verification -------------------------------------------------------
w(`------------------------------------------------------------------------------`)
w(`-- What just landed`)
w(`------------------------------------------------------------------------------`)
w(`SELECT d.driver_code, d.pay_basis,`)
w(`       CONVERT(char(10), s.check_date, 120) AS check_date,`)
w(`       r.route_pay, l.line_total,`)
w(`       r.route_pay + l.line_total AS settlement_total,`)
w(`       e.escrow_balance`)
w(`FROM dbo.Settlements AS s`)
w(`JOIN dbo.Drivers AS d ON d.driver_code = s.driver_code`)
w(`CROSS APPLY (SELECT COALESCE(SUM(pay_amount), 0) AS route_pay`)
w(`             FROM dbo.SettlementRoutes WHERE settlement_id = s.settlement_id) AS r`)
w(`CROSS APPLY (SELECT COALESCE(SUM(amount), 0) AS line_total`)
w(`             FROM dbo.SettlementLines WHERE settlement_id = s.settlement_id) AS l`)
w(`CROSS APPLY (SELECT COALESCE(SUM(current_balance), 0) AS escrow_balance`)
w(`             FROM dbo.SettlementEscrow WHERE settlement_id = s.settlement_id) AS e`)
w(`WHERE d.driver_type = 'OWNER'`)
w(`ORDER BY d.driver_code, s.check_date DESC;`)
w()

process.stdout.write(out.join('\n'))
