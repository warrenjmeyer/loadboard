const sql = require('mssql')

// ---------------------------------------------------------------------------
// One connection pool, shared by every function in this app.
//
// This lives in its own module because Node caches a module after the first
// require: whichever function runs first creates the pool, and the rest get
// the same one. Two functions each holding their own pool would double the
// connections for no benefit -- and Azure SQL counts connections.
// ---------------------------------------------------------------------------

const config = {
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    // Azure SQL requires TLS. Stating it means a local run against a
    // non-Azure server behaves the same way.
    encrypt: true,
  },
  // Millstream is serverless (GP_S_Gen5_2) and auto-pauses when idle. The
  // first connection after a pause triggers a resume that can take 30-60s.
  // Static Web Apps will cut the request off before that finishes, so the
  // browser retries -- see the comment in src/App.jsx. Ask for the time
  // anyway: nothing is gained by giving up sooner than the platform does.
  connectionTimeout: 120000,
  requestTimeout: 60000,
  pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
}

let poolPromise = null

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
      // Clear the cache on failure. Otherwise one bad connect -- a paused
      // database, a transient network fault -- is remembered forever and
      // every later request replays the same rejected promise.
      poolPromise = null
      throw err
    })
  }
  return poolPromise
}

module.exports = { getPool, sql }
