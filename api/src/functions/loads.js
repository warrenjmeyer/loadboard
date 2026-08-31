const { app } = require('@azure/functions')
const { getPool } = require('../db')

// ---------------------------------------------------------------------------
// GET /api/loads -- the rows behind the load board, read live from SQL on
// every request.
//
// This is the piece a static site cannot have. The credential lives in the
// Function App's settings (see set-api-secrets.ps1), so it exists only on the
// server; the browser receives rows and never sees a connection string.
// ---------------------------------------------------------------------------

app.http('loads', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'loads',
  handler: async (request, context) => {
    try {
      const pool = await getPool()

      // Explicit column list: it keeps the shape stable if someone adds a
      // column to the table later.
      const result = await pool.request().query(`
        SELECT id, origin, destination, miles, rate, equipment, status,
               driver_code, delivered_date
        FROM dbo.Loads
        ORDER BY id;
      `)

      const rows = result.recordset.map((r) => ({
        id: r.id,
        origin: r.origin,
        destination: r.destination,
        miles: Number(r.miles),
        // rate is DECIMAL(10,2); Number() keeps 585.00 serialising as 585,
        // matching what the front end already expects.
        rate: Number(r.rate),
        equipment: r.equipment,
        status: r.status,
        // Both null unless the load has been delivered. CK_Loads_delivered
        // makes sure they are either both present or both absent, so the front
        // end never has to handle a delivery date with nobody attached to it.
        driverCode: r.driver_code,
        deliveredDate: r.delivered_date ? r.delivered_date.toISOString().slice(0, 10) : null,
      }))

      return {
        jsonBody: rows,
        headers: {
          // The data changes rarely and a stale board is worse than a slow
          // one, so no caching. Revisit if this ever gets traffic.
          'Cache-Control': 'no-store',
        },
      }
    } catch (err) {
      // Log the real error server-side; return a generic one. A SQL error
      // message can name the server, the database and the login, and none of
      // that belongs in a browser.
      context.error('GET /api/loads failed:', err)
      return {
        status: 500,
        jsonBody: { error: 'Could not load data.' },
      }
    }
  },
})
