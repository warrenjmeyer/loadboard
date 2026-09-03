const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')

// ---------------------------------------------------------------------------
// The settlement (pay statement), for both kinds of driver.
//
//   GET /api/drivers/{driverCode}/settlements
//       -> the check dates this driver has, newest first (feeds the dropdown)
//
//   GET /api/drivers/{driverCode}/settlements/{checkDate}
//       -> one full statement
//
// ONE PAYLOAD SERVES BOTH KINDS OF DRIVER, and driver.driverType says which.
// A company driver is a W-2 employee paid by the mile; an owner/operator is a
// 1099 contractor who owns the truck, so fuel, the truck payment and its
// insurance come out of the settlement and nothing is withheld for tax. The
// original had two ColdFusion pages against two sets of DB2 tables
// (CODRIVERS_* and OWNER_OPERATOR_*) that held the same columns under
// different names; here it is one set of tables and one route, because the
// difference between the two is what the numbers MEAN, not what shape they
// arrive in.
//
// The owner/operator-only parts of the payload are `comparison` (every figure
// weekly against year-to-date) and `escrow`. They are computed for everyone --
// a company driver simply has no escrow rows, and their page does not ask for
// the comparison.
//
// Every value that comes from the URL is passed as a bound parameter. The
// ColdFusion original interpolated #url.id# straight into its SQL, which meant
// the driver code was executable; here it can only ever be data.
//
// ALL FOUR ROUTES NOW REQUIRE A SIGNED-IN USER. They were anonymous until
// today, which meant /api/drivers/JSMITH/settlements handed anyone's pay
// statement to anyone who knew the driver code -- and driver codes are on the
// load board. The money in there is invented, the names are real.
//
// The rule differs by route. The board and the driver list are aggregate
// views, so they need dispatcher or admin. A single driver's statement is
// readable by that driver, and the comparison is against the DriverCode on
// their account -- never against anything in the URL, because the URL is the
// question, not the answer.
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
      // An aggregate view of everybody's pay. Dispatchers and admins only.
      const user = await identity.currentUser(request)
      if (!user) return identity.unauthorized('Sign in to view settlements.')
      if (!identity.can(user, 'viewAllSettlements')) {
        return identity.forbidden(
          user.role === 'driver'
            ? 'Drivers can only open their own settlement.'
            : 'Your account does not have access to settlements.'
        )
      }

      const pool = await getPool()

      // Totals are computed here rather than stored, the same way the detail
      // endpoint does it -- one definition of what a settlement is worth, so
      // the board and the statement can never disagree.
      //
      // CROSS APPLY for routes because every settlement has them; OUTER APPLY
      // for lines because one legitimately might not, and an INNER join would
      // silently drop it from the board.
      const result = await pool.request().query(`
        SELECT s.driver_code, d.first_name, d.last_name, d.driver_type,
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
            // Lets the board mark which statements are owner/operator ones.
            // The link is the same either way -- the statement page decides
            // what to render -- but the two documents mean different things
            // and a column of totals that mixes them silently is misleading.
            driverType: r.driver_type,
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
      // An aggregate view of everybody's pay. Dispatchers and admins only.
      const user = await identity.currentUser(request)
      if (!user) return identity.unauthorized('Sign in to view settlements.')
      if (!identity.can(user, 'viewAllSettlements')) {
        return identity.forbidden(
          user.role === 'driver'
            ? 'Drivers can only open their own settlement.'
            : 'Your account does not have access to settlements.'
        )
      }

      const pool = await getPool()

      // Only drivers who actually have a settlement. A link to an empty
      // statement is a dead end, and the list exists to be clicked.
      const result = await pool.request().query(`
        SELECT d.driver_code, d.first_name, d.last_name, d.driver_type,
               COUNT(s.settlement_id) AS settlement_count
        FROM dbo.Drivers AS d
        JOIN dbo.Settlements AS s ON s.driver_code = d.driver_code
        GROUP BY d.driver_code, d.first_name, d.last_name, d.driver_type
        ORDER BY d.last_name, d.first_name;
      `)

      return {
        jsonBody: result.recordset.map((r) => ({
          driverCode: r.driver_code,
          firstName: r.first_name,
          lastName: r.last_name,
          driverType: r.driver_type,
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

    // A driver may open their own statement and nobody else's; dispatchers and
    // admins may open anyone's. The comparison happens inside canViewDriver
    // against the DriverCode on the account -- the code in the URL is what is
    // being asked about, never what grants the access.
    //
    // 403 rather than 404 for a driver asking after someone else. Hiding it as
    // "not found" would be tidier, but it would also mean a driver could probe
    // which codes exist by watching 403 turn into 404.
    const user = await identity.currentUser(request)
    if (!user) return identity.unauthorized('Sign in to view this settlement.')
    if (!identity.canViewDriver(user, driverCode)) {
      return identity.forbidden('You can only open your own settlement.')
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

    // A driver may open their own statement and nobody else's; dispatchers and
    // admins may open anyone's. The comparison happens inside canViewDriver
    // against the DriverCode on the account -- the code in the URL is what is
    // being asked about, never what grants the access.
    //
    // 403 rather than 404 for a driver asking after someone else. Hiding it as
    // "not found" would be tidier, but it would also mean a driver could probe
    // which codes exist by watching 403 turn into 404.
    const user = await identity.currentUser(request)
    if (!user) return identity.unauthorized('Sign in to view this settlement.')
    if (!identity.canViewDriver(user, driverCode)) {
      return identity.forbidden('You can only open your own settlement.')
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
                 d.driver_type, d.pay_basis, d.unit_no, d.truck_description,
                 s.settlement_id, s.check_date, s.period_start, s.period_end,
                 s.document_no
          FROM dbo.Settlements AS s
          JOIN dbo.Drivers AS d ON d.driver_code = s.driver_code
          WHERE s.driver_code = @driverCode AND s.check_date = @checkDate;

          -- 1: earnings by load
          SELECT r.order_no, r.load_id, r.dispatch_no, r.unit_no, r.route_detail,
                 r.loaded_miles, r.empty_miles, r.total_miles,
                 r.linehaul_revenue, r.pay_rate, r.pay_amount
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

          -- 3: year-to-date miles and trip pay, through this check date
          SELECT COALESCE(SUM(r.loaded_miles), 0) AS loaded,
                 COALESCE(SUM(r.empty_miles), 0)  AS empty,
                 COALESCE(SUM(r.total_miles), 0)  AS total,
                 COALESCE(SUM(r.pay_amount), 0)   AS route_pay
          FROM dbo.SettlementRoutes AS r
          JOIN dbo.Settlements AS s ON s.settlement_id = r.settlement_id
          WHERE s.driver_code = @driverCode
            AND s.check_date <= @checkDate
            AND s.check_date >= DATEFROMPARTS(YEAR(@checkDate), 1, 1);

          -- 4: year-to-date lines, one row per type and description
          --
          -- Grouped by description rather than returned raw, because the
          -- weekly-vs-YTD grid compares like with like: "FUEL - COMCHEK" this
          -- week against "FUEL - COMCHEK" so far this year. Fifty-two raw rows
          -- would have to be summed in the browser anyway.
          SELECT l.line_type, l.description, SUM(l.amount) AS amount
          FROM dbo.SettlementLines AS l
          JOIN dbo.Settlements AS s ON s.settlement_id = l.settlement_id
          WHERE s.driver_code = @driverCode
            AND s.check_date <= @checkDate
            AND s.check_date >= DATEFROMPARTS(YEAR(@checkDate), 1, 1)
          GROUP BY l.line_type, l.description;

          -- 5: escrow and loan balances as they stood on this settlement
          SELECT e.escrow_code, e.description, e.beginning_balance,
                 e.transaction_amount, e.current_balance
          FROM dbo.SettlementEscrow AS e
          JOIN dbo.Settlements AS s ON s.settlement_id = e.settlement_id
          WHERE s.driver_code = @driverCode AND s.check_date = @checkDate
          ORDER BY e.escrow_code;
        `)

      const [headerRows, routeRows, lineRows, ytdRows, ytdLineRows, escrowRows] =
        result.recordsets

      if (!headerRows.length) {
        return { status: 404, jsonBody: { error: 'No settlement for that driver and check date.' } }
      }

      const h = headerRows[0]

      const routes = routeRows.map((r) => {
        const totalMiles = Number(r.total_miles)
        const payAmount = money(r.pay_amount)
        return {
          orderNo: r.order_no,
          // Null on a SPECIAL line -- breakdown or layover pay, which is real
          // money for no freight and has no load to point at.
          loadId: r.load_id,
          dispatchNo: r.dispatch_no,
          unitNo: r.unit_no,
          routeDetail: r.route_detail,
          loadedMiles: Number(r.loaded_miles),
          emptyMiles: Number(r.empty_miles),
          totalMiles,
          // What the load billed the customer. Only a percentage driver's pay
          // is a share of it, so it is null on every mileage line rather than
          // repeated as decoration.
          linehaulRevenue:
            r.linehaul_revenue === null || r.linehaul_revenue === undefined
              ? null
              : money(r.linehaul_revenue),
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

      const ytd = ytdRows[0] || { loaded: 0, empty: 0, total: 0, route_pay: 0 }

      // -------------------------------------------------------------------
      // Weekly against year-to-date.
      //
      // The owner/operator statement is built around this comparison -- a
      // contractor is running a business, and one week in isolation does not
      // tell them whether it is working. The company statement has no
      // equivalent because a W-2 driver's YTD lives in payroll, not here.
      //
      // A description that appears in either column has to appear in both, so
      // the sets are unioned rather than driven off the weekly rows. A fuel
      // deduction that ran every week except this one is exactly the row
      // someone is looking for, and driving the list off this week alone would
      // silently drop it.
      // -------------------------------------------------------------------
      const ytdLines = ytdLineRows.map((l) => ({
        type: l.line_type,
        description: l.description,
        amount: money(l.amount),
      }))

      const ytdRoutePay = money(ytd.route_pay)

      const compare = (type, weeklyRows) => {
        const ytdRows = ytdLines.filter((l) => l.type === type)

        const weeklyByDescription = new Map()
        for (const l of weeklyRows) {
          weeklyByDescription.set(
            l.description,
            (weeklyByDescription.get(l.description) ?? 0) + l.amount
          )
        }
        const ytdByDescription = new Map(ytdRows.map((l) => [l.description, l.amount]))

        const descriptions = [
          ...new Set([...weeklyByDescription.keys(), ...ytdByDescription.keys()]),
        ].sort()

        return descriptions.map((description) => ({
          description,
          weekly: weeklyByDescription.get(description) ?? 0,
          ytd: ytdByDescription.get(description) ?? 0,
        }))
      }

      const ytdTotalFor = (type) =>
        ytdLines.filter((l) => l.type === type).reduce((t, l) => t + l.amount, 0)

      // Trip pay is compensation too, and it is the largest part of it -- but
      // it lives in SettlementRoutes rather than SettlementLines, so it is
      // prepended as a row rather than coming out of the group-by. It stays
      // first regardless of the alphabetical sort below it: it is the reason
      // the settlement exists.
      const compensationLines = [
        { description: 'Trip Pay', weekly: routePay, ytd: ytdRoutePay },
        ...compare('REVENUE', revenue),
      ]

      const comparison = {
        compensation: {
          lines: compensationLines,
          weekly: routePay + revenueTotal,
          ytd: ytdRoutePay + ytdTotalFor('REVENUE'),
        },
        reimbursements: {
          // Per diem is not split out here the way it is on the company
          // statement. An owner/operator is a 1099 contractor: there is no
          // per-diem substantiation for the carrier to track, so the block
          // would always be empty.
          lines: compare('REIMBURSEMENT', [...perDiem, ...reimbursements]),
          weekly: perDiemTotal + reimbursementTotal,
          ytd: ytdTotalFor('REIMBURSEMENT'),
        },
        deductions: {
          lines: compare('DEDUCTION', deductions),
          weekly: deductionTotal,
          ytd: ytdTotalFor('DEDUCTION'),
        },
      }

      comparison.total = {
        weekly:
          comparison.compensation.weekly +
          comparison.reimbursements.weekly +
          comparison.deductions.weekly,
        ytd:
          comparison.compensation.ytd +
          comparison.reimbursements.ytd +
          comparison.deductions.ytd,
      }

      // Escrow: money the carrier holds on the driver's behalf, not money the
      // driver was paid. It is reported alongside the settlement rather than
      // inside its total, and the weekly contribution already appears as a
      // deduction -- counting the balance as income would be wrong twice over.
      //
      // Rows with a zero balance are kept. The original hid any row where the
      // beginning or current balance was zero, which silently dropped a newly
      // opened account -- the one a driver most wants to see start.
      const escrow = escrowRows.map((e) => ({
        code: e.escrow_code,
        description: e.description,
        beginningBalance: money(e.beginning_balance),
        transactionAmount: money(e.transaction_amount),
        currentBalance: money(e.current_balance),
      }))

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
            // COMPANY or OWNER. The front end picks which statement to render
            // off this one field, so a driver never has to know which kind of
            // URL is theirs -- see src/pages/Settlement.jsx.
            driverType: h.driver_type,
            // MILEAGE or PERCENTAGE, and null for a company driver. It is what
            // makes pay_rate readable: 0.68 is 68% of the linehaul on a
            // percentage contract and 68 cents a mile on a mileage one, and
            // nothing else in the payload distinguishes them.
            payBasis: h.pay_basis,
            unitNo: h.unit_no,
            truckDescription: h.truck_description,
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
            // Deliberately NOT called netPay, because whether it IS net pay
            // depends on who is reading it -- which is exactly why the name
            // must not claim.
            //
            // For a company driver, no. Nothing here withholds tax: the
            // original took net pay from UKG, which had the driver's W-4,
            // filing status and YTD wages. This figure is 20-25% above what
            // actually lands in their account.
            //
            // For an owner/operator, effectively yes -- a 1099 contractor has
            // nothing withheld, so this is the cheque. But they owe quarterly
            // estimated tax on it, so it is still not money they get to keep,
            // and the page says so rather than letting the number imply it.
            settlementTotal:
              routePay + revenueTotal + perDiemTotal + reimbursementTotal + deductionTotal,
          },
          ytd: {
            loadedMiles: Number(ytd.loaded),
            emptyMiles: Number(ytd.empty),
            totalMiles: Number(ytd.total),
            routePay: ytdRoutePay,
          },
          comparison,
          escrow,
          escrowTotal: escrow.reduce((t, e) => t + e.currentBalance, 0),
        },
        headers: { 'Cache-Control': 'no-store' },
      }
    } catch (err) {
      context.error('GET settlement detail failed:', err)
      return { status: 500, jsonBody: { error: 'Could not load the settlement.' } }
    }
  },
})
