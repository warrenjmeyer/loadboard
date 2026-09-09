const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const rules = require('../payrunRules')

// ---------------------------------------------------------------------------
// The pay run: delivered loads become settlements.
//
//   GET  /api/payrun?periodStart=&periodEnd=&checkDate=
//        what a run would create, driver by driver, with nothing written
//   POST /api/payrun  { periodStart, periodEnd, checkDate, driverCodes? }
//        create them, in one transaction
//
// Admin only. Payroll is not dispatch.
//
// What counts as unpaid: a Delivered load with no SettlementRoutes row
// pointing at it (FK_Routes_load). That is the whole test, and it is why the
// link between loads and settlements was worth building in settlement_05 --
// without it "has this load been paid" has no answer.
//
// The run pays everything delivered ON OR BEFORE the period's end that is
// still unpaid, not only what was delivered inside the period. A load that
// slipped through last week's run is paid this week and marked as carried
// over; leaving it for someone to notice is how drivers stop trusting the
// statement.
//
// Only route pay is generated. Reimbursements and deductions -- per diem,
// advances, an owner/operator's fuel and truck payment -- are not on the load
// and are not invented here. A generated statement says so in its lines
// section, and adding them is a later, separate piece of work.
// ---------------------------------------------------------------------------

const isoDate = (v) => (v ? v.toISOString().slice(0, 10) : null)

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

async function gate(request) {
  const user = await identity.currentUser(request)
  if (!user) return { error: identity.unauthorized('Sign in to run payroll.') }
  if (!identity.can(user, 'runPayroll')) return { error: identity.forbidden('Only an administrator can run payroll.') }
  return { user }
}

// The unpaid delivered loads up to a date, their drivers, and who already has
// a settlement on the check date. One round trip, three result sets.
async function gather(req, { periodEnd, checkDate }) {
  const result = await req
    .input('periodEnd', sql.VarChar(10), periodEnd)
    .input('checkDate', sql.VarChar(10), checkDate)
    .query(`
      SELECT l.id, l.origin, l.destination, l.miles, l.empty_miles, l.rate, l.unit_no, l.driver_code, l.delivered_date
      FROM dbo.Loads AS l
      WHERE l.status = N'Delivered'
        AND l.delivered_date <= CAST(@periodEnd AS DATE)
        AND NOT EXISTS (SELECT 1 FROM dbo.SettlementRoutes AS r WHERE r.load_id = l.id)
      ORDER BY l.driver_code, l.delivered_date, l.id;

      SELECT d.driver_code, d.first_name, d.last_name, d.driver_type, d.pay_basis, d.pay_rate, d.unit_no
      FROM dbo.Drivers AS d;

      SELECT s.driver_code FROM dbo.Settlements AS s WHERE s.check_date = CAST(@checkDate AS DATE);
    `)

  const loads = result.recordsets[0].map((r) => ({
    id: r.id, origin: r.origin, destination: r.destination,
    miles: Number(r.miles), emptyMiles: Number(r.empty_miles || 0), rate: Number(r.rate),
    unitNo: r.unit_no, driverCode: r.driver_code, deliveredDate: isoDate(r.delivered_date),
  }))
  const drivers = {}
  for (const d of result.recordsets[1]) {
    drivers[d.driver_code] = {
      name: `${d.first_name} ${d.last_name}`, driverType: d.driver_type, payBasis: d.pay_basis,
      payRate: Number(d.pay_rate), unitNo: d.unit_no,
    }
  }
  const existing = new Set(result.recordsets[2].map((r) => r.driver_code))
  return { loads, drivers, existing }
}

function periodFrom(source) {
  const today = new Date().toISOString().slice(0, 10)
  const defaults = rules.defaultPeriod(today)
  return {
    periodStart: source.periodStart || defaults.periodStart,
    periodEnd: source.periodEnd || defaults.periodEnd,
    checkDate: source.checkDate || defaults.checkDate,
  }
}

async function preview(request) {
  const g = await gate(request)
  if (g.error) return g.error

  const q = request.query
  const period = periodFrom({ periodStart: q.get('periodStart'), periodEnd: q.get('periodEnd'), checkDate: q.get('checkDate') })
  const errors = rules.validatePeriod(period)
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const { loads, drivers, existing } = await gather(pool.request(), period)
  return { jsonBody: rules.plan(loads, drivers, { ...period, existing }), headers: { 'Cache-Control': 'no-store' } }
}

async function run(request, context) {
  const g = await gate(request)
  if (g.error) return g.error

  let body
  try {
    body = (await request.json()) || {}
  } catch {
    return badRequest('Expected a JSON body.')
  }
  const period = periodFrom(body)
  const errors = rules.validatePeriod(period)
  if (errors.length) return badRequest(errors)

  const only = Array.isArray(body.driverCodes) && body.driverCodes.length
    ? new Set(body.driverCodes.map((c) => String(c).toUpperCase()))
    : null

  const pool = await getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()

  try {
    const { loads, drivers, existing } = await gather(new sql.Request(tx), period)
    const planned = rules.plan(loads, drivers, { ...period, existing })
    const chosen = planned.settlements.filter((s) => !only || only.has(s.driverCode))

    if (chosen.length === 0) {
      await tx.rollback()
      return badRequest('Nothing to pay: no unpaid delivered loads for the drivers chosen.')
    }

    // A driver who already has a statement on this check date is a mistake
    // somewhere -- a run done twice, or a date typed wrong -- and refusing the
    // whole run is safer than paying everyone else and leaving one to sort
    // out. The message names them; the caller can exclude them or fix the
    // date.
    const conflicts = chosen.filter((s) => s.conflict)
    if (conflicts.length) {
      await tx.rollback()
      return {
        status: 409,
        jsonBody: { error: `Already paid on ${period.checkDate}: ${conflicts.map((s) => s.driverCode).join(', ')}. Exclude them or change the check date.` },
      }
    }

    // Document numbers continue the sequence for this check date.
    const seqRow = await new sql.Request(tx).input('checkDate', sql.VarChar(10), period.checkDate).query(`
      SELECT MAX(TRY_CAST(RIGHT(document_no, 4) AS INT)) AS seq FROM dbo.Settlements WHERE check_date = CAST(@checkDate AS DATE);
    `)
    let seq = Number(seqRow.recordset[0].seq || 0)

    const created = []
    for (const s of chosen) {
      seq += 1
      const docNo = rules.documentNo(period.checkDate, seq)

      const head = await new sql.Request(tx)
        .input('driverCode', sql.VarChar(20), s.driverCode)
        .input('checkDate', sql.VarChar(10), period.checkDate)
        .input('periodStart', sql.VarChar(10), period.periodStart)
        .input('periodEnd', sql.VarChar(10), period.periodEnd)
        .input('docNo', sql.VarChar(20), docNo)
        .query(`
          INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
          OUTPUT inserted.settlement_id
          VALUES (@driverCode, CAST(@checkDate AS DATE), CAST(@periodStart AS DATE), CAST(@periodEnd AS DATE), @docNo);
        `)
      const settlementId = head.recordset[0].settlement_id

      for (const r of s.routes) {
        await new sql.Request(tx)
          .input('sid', sql.Int, settlementId)
          .input('orderNo', sql.VarChar(20), r.orderNo)
          .input('loadId', sql.VarChar(20), r.loadId)
          .input('unitNo', sql.VarChar(20), r.unitNo)
          .input('routeDetail', sql.NVarChar(200), r.routeDetail)
          .input('loaded', sql.Int, r.loadedMiles)
          .input('empty', sql.Int, r.emptyMiles)
          .input('total', sql.Int, r.totalMiles)
          .input('linehaul', sql.Decimal(12, 2), r.linehaulRevenue)
          .input('payRate', sql.Decimal(9, 4), r.payRate)
          .input('payAmount', sql.Decimal(12, 2), r.payAmount)
          .input('actor', sql.NVarChar(256), g.user.email)
          .input('detail', sql.NVarChar(400), `Paid on ${docNo}`)
          .query(`
            INSERT INTO dbo.SettlementRoutes
              (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail,
               loaded_miles, empty_miles, total_miles, linehaul_revenue, pay_rate, pay_amount)
            VALUES (@sid, @orderNo, @loadId, NULL, @unitNo, @routeDetail,
                    @loaded, @empty, @total, @linehaul, @payRate, @payAmount);

            INSERT INTO dbo.LoadEvents (load_id, actor, event_type, detail)
            VALUES (@loadId, @actor, 'Edited', @detail);
          `)
      }

      created.push({
        driverCode: s.driverCode, name: s.name, driverType: s.driverType,
        checkDate: period.checkDate, documentNo: docNo,
        loadCount: s.loadCount, totalMiles: s.totalMiles, routePay: s.routePay,
      })
    }

    await tx.commit()
    context.log(`Pay run ${period.checkDate} by ${g.user.email}: ${created.length} settlements, ${created.reduce((t, c) => t + c.loadCount, 0)} loads`)

    return { status: 201, jsonBody: { ...period, created }, headers: { 'Cache-Control': 'no-store' } }
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      // UQ_Settlements_driver_date: two runs raced for the same driver and
      // date. The plan checked, the constraint decided.
      if (err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'A settlement for that driver and check date was created by another run. Preview again.' } }
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not run payroll.' } }
    }
  }
}

app.http('payrun', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'payrun',
  handler: wrap('/api/payrun', (request, context) =>
    request.method === 'POST' ? run(request, context) : preview(request)),
})
