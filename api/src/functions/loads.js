const { app } = require('@azure/functions')
const sql = require('mssql')

// ---------------------------------------------------------------------------
// GET /api/loads -- the rows behind the load board, read live from SQL on
// every request.
//
// This is the piece a static site cannot have. The credential lives in the
// Function App's settings (see set-api-secrets.ps1), so it exists only on the
// server; the browser receives rows and never sees a connection string.
// ---------------------------------------------------------------------------

const config = {
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    // Azure SQL requires TLS. This is the default for Azure but stating it
    // means a local run against a non-Azure server behaves the same way.
    encrypt: true,
  },
  // Millstream is serverless (GP_S_Gen5_2) and auto-pauses when idle. The
  // first request after a pause triggers a resume that can take 30-60s -- the
  // exact trap that produces a misleading pre-login handshake timeout.
  // Give a cold start room rather than failing the request.
  connectionTimeout: 120000,
  requestTimeout: 60000,
  pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
}

// A module-level promise, not a connection. Azure Functions reuses a warm
// process across invocations, so caching the pool here means only the first
// request pays for the handshake. Storing the *promise* rather than the pool
// also collapses a burst of simultaneous cold requests into one connect.
let poolPromise = null

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
      // Clear the cache on failure. Otherwise one bad connect (a paused
      // database, a transient network fault) is remembered forever and every
      // later request replays the same rejected promise.
      poolPromise = null
      throw err
    })
  }
  return poolPromise
}

app.http('loads', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'loads',
  handler: async (request, context) => {
    try {
      const pool = await getPool()

      // Explicit column list, same as the export script: it keeps the shape
      // stable if someone adds a column to the table later.
      const result = await pool.request().query(`
        SELECT id, origin, destination, miles, rate, equipment, status
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
