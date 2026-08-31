const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')

// ---------------------------------------------------------------------------
// The company-driver settlement (pay statement).
//
//   GET /api/drivers/{driverCode}/settlements
//       -> the check dates this driver has, newest first (feeds the dropdown)
//
//   GET /api/drivers/{driverCode}/settlements/{checkDate}
//       -> one full statement
//
// Every value that comes from the URL is passed as a bound parameter. The
// ColdFusion original interpolated #url.id# straight into its SQL, which meant
// the driver code was executable; here it can only ever be data.
// ---------------------------------------------------------------------------

const DRIVER_CODE = /^[A-Za-z0-9_-]{1,20}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// mssql returns DECIMAL as a string in some driver versions and a number in
// others. Going through Number() means the JSON always carries numbers, so the
// front end never has to guess.
const money = (v) => (v === null || v === undefined ? 0 : Number(v))

app.http('settlementBoard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'settlements',
  handler: async (request, context) => {
    try {
      const pool = await getPool()

      // Totals are computed here rather than stored, the same way the detail
      // endpoint does it -- one definition of what a settlement is worth, so
      // the board and the statement can never disagree.
      //
      // CROSS APPLY for routes because every settlement has them; OUTER APPLY
      // for lines because one legitimately might not, and an INNER join would
      // silently drop it from the board.
      const result = await pool.request().query(`
        SELECT s.driver_code, d.first_name, d.last_name,
               s.check_date, s.period_start, s.period_end, s.document_no,
               r.load_count, r.miles, r.route_pay,
               COALESCE(l.line_total, 0)  AS line_total,
               COALESCE(l.deduction_count, 0) AS deduction_count
        FROM dbo.Settlements AS s
        JOIN dbo.Drivers AS d ON d.driver_code = s.driver_code
        CROSS APPLY (
            SELECT COUNT(*) AS load_count,
                   COALESCE(SUM(total_miles), 0) AS miles,
                   COALESCE(SUM(pay_amount), 0)  AS route_pay
            FROM dbo.SettlementRoutes WHERE settlement_id = s.settlement_id
        ) AS r
        OUTER APPLY (
            SELECT SUM(amount) AS line_total,
                   SUM(CASE WHEN line_type = 'DEDUCTION' THEN 1 ELSE 0 END) AS deduction_count
            FROM dbo.SettlementLines WHERE settlement_id = s.settlement_id
        ) AS l
        ORDER BY s.check_date DESC, d.last_name, d.first_name;
      `)

      return {
        jsonBody: result.recordset.map((r) => {
          const miles = Number(r.miles)
          const total = money(r.route_pay) + money(r.line_total)
          return {
            driverCode: r.driver_code,
            driverName: `${r.first_name} ${r.last_name}`,
            checkDate: r.check_date.toISOString().slice(0, 10),
            periodStart: r.period_start.toISOString().slice(0, 10),
            periodEnd: r.period_end.toISOString().slice(0, 10),
            documentNo: r.document_no,
            loadCount: Number(r.load_count),
            miles,
            settlementTotal: total,
            // Dollars per mile, the same figure the load board shows -- but a
            // settlement with no miles (all flat pay) would divide by zero, so
            // it reports null and the table prints an em dash.
            perMile: miles > 0 ? total / miles : null,
            hasDeductions: Number(r.deduction_count) > 0,
          }
        }),
        headers: { 'Cache-Control': 'no-store' },
      }
    } catch (err) {
      context.error('GET /api/settlements failed:', err)
      return { status: 500, jsonBody: { error: 'Could not load settlements.' } }
    }
  },
})

app.http('driverList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'drivers',
  handler: async (request, context) => {
    try {
      const pool = await getPool()

      // Only drivers who actually have a settlement. A link to an empty
      // statement is a dead end, and the list exists to be clicked.
      const result = await pool.request().query(`
        SELECT d.driver_code, d.first_name, d.last_name,
               COUNT(s.settlement_id) AS settlement_count
        FROM dbo.Drivers AS d
        JOIN dbo.Settlements AS s ON s.driver_code = d.driver_code
        GROUP BY d.driver_code, d.first_name, d.last_name
        ORDER BY d.last_name, d.first_name;
      `)

      return {
        jsonBody: result.recordset.map((r) => ({
          driverCode: r.driver_code,
          firstName: r.first_name,
          lastName: r.last_name,
          settlementCount: Number(r.settlement_count),
        })),
        headers: { 'Cache-Control': 'no-store' },
      }
    } catch (err) {
      context.error('GET /api/drivers failed:', err)
      return { status: 500, jsonBody: { error: 'Could not load drivers.' } }
    }
  },
})

app.http('settlementList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'drivers/{driverCode}/settlements',
  handler: async (request, context) => {
    const driverCode = request.params.driverCode

    if (!DRIVER_CODE.test(driverCode)) {
      return { status: 400, jsonBody: { error: 'Invalid driver code.' } }
    }

    try {
      const pool = await getPool()
      const result = await pool
        .request()
        .input('driverCode', sql.VarChar(20), driverCode.toUpperCase())
        .query(`
          SELECT s.check_date, s.period_start, s.period_end, s.document_no
          FROM dbo.Settlements AS s
          WHERE s.driver_code = @driverCode
          ORDER BY s.check_date DESC;
        `)

      return {
        jsonBody: result.recordset.map((r) => ({
          checkDate: r.check_date.toISOString().slice(0, 10),
          periodStart: r.period_start.toISOString().slice(0, 10),
          periodEnd: r.period_end.toISOString().slice(0, 10),
          documentNo: r.document_no,
        })),
        headers: { 'Cache-Control': 'no-store' },
      }
    } catch (err) {
      context.error('GET settlements list failed:', err)
      return { status: 500, jsonBody: { error: 'Could not load settlements.' } }
    }
  },
})

app.http('settlementDetail', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'drivers/{driverCode}/settlements/{checkDate}',
  handler: async (request, context) => {
    const driverCode = request.params.driverCode
    const checkDate = request.params.checkDate

    if (!DRIVER_CODE.test(driverCode)) {
      return { status: 400, jsonBody: { error: 'Invalid driver code.' } }
    }
    if (!ISO_DATE.test(checkDate)) {
      return { status: 400, jsonBody: { error: 'Check date must be YYYY-MM-DD.' } }
    }

    try {
      const pool = await getPool()

      // One round trip, four result sets. Chattier code would await four
      // separate queries and pay four network hops for data that is always
      // fetched together.
      const result = await pool
        .request()
        .input('driverCode', sql.VarChar(20), driverCode.toUpperCase())
        .input('checkDate', sql.Date, checkDate)
        .query(`
          -- 0: driver + settlement header
          SELECT d.driver_code, d.first_name, d.last_name, d.address1, d.address2,
                 d.city, d.state, d.postal_code, d.country, d.ssn_last4, d.job,
                 d.pay_rate, d.pay_frequency, d.pay_group, d.location,
                 d.department, d.job_type,
                 s.settlement_id, s.check_date, s.period_start, s.period_end,
                 s.document_no
          FROM dbo.Settlements AS s
          JOIN dbo.Drivers AS d ON d.driver_code = s.driver_code
          WHERE s.driver_code = @driverCode AND s.check_date = @checkDate;

          -- 1: earnings by load
          SELECT r.order_no, r.dispatch_no, r.unit_no, r.route_detail,
                 r.loaded_miles, r.empty_miles, r.total_miles,
                 r.pay_rate, r.pay_amount
          FROM dbo.SettlementRoutes AS r
          JOIN dbo.Settlements AS s ON s.settlement_id = r.settlement_id
          WHERE s.driver_code = @driverCode AND s.check_date = @checkDate
          ORDER BY r.order_no;

          -- 2: revenue / reimbursement / deduction lines
          SELECT l.line_type, l.order_no, l.code, l.description,
                 l.advance_reference, l.amount
          FROM dbo.SettlementLines AS l
          JOIN dbo.Settlements AS s ON s.settlement_id = l.settlement_id
          WHERE s.driver_code = @driverCode AND s.check_date = @checkDate
          ORDER BY l.line_type, l.description;

          -- 3: year-to-date miles, through this check date
          SELECT COALESCE(SUM(r.loaded_miles), 0) AS loaded,
                 COALESCE(SUM(r.empty_miles), 0)  AS empty,
                 COALESCE(SUM(r.total_miles), 0)  AS total
          FROM dbo.SettlementRoutes AS r
          JOIN dbo.Settlements AS s ON s.settlement_id = r.settlement_id
          WHERE s.driver_code = @driverCode
            AND s.check_date <= @checkDate
            AND s.check_date >= DATEFROMPARTS(YEAR(@checkDate), 1, 1);
        `)

      const [headerRows, routeRows, lineRows, ytdRows] = result.recordsets

      if (!headerRows.length) {
        return { status: 404, jsonBody: { error: 'No settlement for that driver and check date.' } }
      }

      const h = headerRows[0]

      const routes = routeRows.map((r) => {
        const totalMiles = Number(r.total_miles)
        const payAmount = money(r.pay_amount)
        return {
          orderNo: r.order_no,
          dispatchNo: r.dispatch_no,
          unitNo: r.unit_no,
          routeDetail: r.route_detail,
          loadedMiles: Number(r.loaded_miles),
          emptyMiles: Number(r.empty_miles),
          totalMiles,
          payRate: money(r.pay_rate),
          payAmount,
          // Rate per mile as the original computed it: when a line has no
          // miles (a flat payment), there is no rate to divide out, so the
          // amount itself is shown rather than a division by zero.
          rpm: totalMiles > 0 ? payAmount / totalMiles : payAmount,
        }
      })

      const lines = lineRows.map((l) => ({
        type: l.line_type,
        orderNo: l.order_no,
        code: l.code,
        description: l.description,
        advanceReference: l.advance_reference,
        amount: money(l.amount),
      }))

      // Per diem is split out of reimbursements and shown as its own block,
      // matching the original. It is a reimbursement like any other; the
      // separation is presentational, so it happens here rather than in SQL.
      const isPerDiem = (l) => /PER DIEM/i.test(l.description)

      const revenue = lines.filter((l) => l.type === 'REVENUE')
      const perDiem = lines.filter((l) => l.type === 'REIMBURSEMENT' && isPerDiem(l))
      const reimbursements = lines.filter((l) => l.type === 'REIMBURSEMENT' && !isPerDiem(l))
      const deductions = lines.filter((l) => l.type === 'DEDUCTION')

      const sum = (rows, key) => rows.reduce((t, r) => t + r[key], 0)

      const routePay = sum(routes, 'payAmount')
      const revenueTotal = sum(revenue, 'amount')
      const perDiemTotal = sum(perDiem, 'amount')
      const reimbursementTotal = sum(reimbursements, 'amount')
      const deductionTotal = sum(deductions, 'amount')

      const ytd = ytdRows[0] || { loaded: 0, empty: 0, total: 0 }

      return {
        jsonBody: {
          driver: {
            driverCode: h.driver_code,
            firstName: h.first_name,
            lastName: h.last_name,
            address1: h.address1,
            address2: h.address2,
            city: h.city,
            state: h.state,
            postalCode: h.postal_code,
            country: h.country,
            ssnLast4: h.ssn_last4,
            job: h.job,
            payRate: money(h.pay_rate),
            payFrequency: h.pay_frequency,
            payGroup: h.pay_group,
            location: h.location,
            department: h.department,
            jobType: h.job_type,
          },
          settlement: {
            checkDate: h.check_date.toISOString().slice(0, 10),
            periodStart: h.period_start.toISOString().slice(0, 10),
            periodEnd: h.period_end.toISOString().slice(0, 10),
            documentNo: h.document_no,
          },
          routes,
          revenue,
          perDiem,
          reimbursements,
          deductions,
          totals: {
            loadedMiles: sum(routes, 'loadedMiles'),
            emptyMiles: sum(routes, 'emptyMiles'),
            totalMiles: sum(routes, 'totalMiles'),
            routePay,
            revenue: revenueTotal,
            perDiem: perDiemTotal,
            reimbursements: reimbursementTotal,
            deductions: deductionTotal,
            // Deductions are already stored negative, so this is a plain sum.
            // Nothing here has to remember which way to flip a sign.
            //
            // Deliberately NOT called netPay. Nothing here withholds tax: the
            // original took net pay from UKG, which had the driver's W-4,
            // filing status and YTD wages. This is what the settlement itself
            // can account for -- earnings less the deductions it knows about --
            // and for a W-2 driver it is 20-25% above what actually lands in
            // their account. Calling it net pay would be a lie on a document
            // whose whole job is being trusted.
            settlementTotal:
              routePay + revenueTotal + perDiemTotal + reimbursementTotal + deductionTotal,
          },
          ytd: {
            loadedMiles: Number(ytd.loaded),
            emptyMiles: Number(ytd.empty),
            totalMiles: Number(ytd.total),
          },
        },
        headers: { 'Cache-Control': 'no-store' },
      }
    } catch (err) {
      context.error('GET settlement detail failed:', err)
      return { status: 500, jsonBody: { error: 'Could not load the settlement.' } }
    }
  },
})
