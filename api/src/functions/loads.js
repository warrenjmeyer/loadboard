const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')

// ---------------------------------------------------------------------------
// /api/loads -- the rows behind the load board, read live from SQL on every
// request, and the route that creates a new one.
//
// This is the piece a static site cannot have. The credential lives in the
// Function App's settings (see set-api-secrets.ps1), so it exists only on the
// server; the browser receives rows and never sees a connection string.
//
// GET and POST share one registration rather than two. Azure Functions keys a
// function by name, and two registrations claiming the same `route` is the
// kind of ambiguity that either errors at startup or -- worse -- silently
// resolves to whichever loaded first. One route, one owner, dispatch inside.
// ---------------------------------------------------------------------------

// The three the form offers, and the only three in the table. There is no
// CHECK constraint on equipment, so this list IS the rule; without it a typo
// in a client becomes a fourth equipment type on the board forever.
const EQUIPMENT = ['Dry Van', 'Reefer', 'Flatbed']

function rowToLoad(r) {
  return {
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
  }
}

// ---------------------------------------------------------------------------
// Who is asking.
//
// Static Web Apps terminates the login itself and hands the Function a base64
// JSON header describing the user. The header is injected by the platform on
// the way in and cannot be forged from outside: SWA strips any
// x-ms-client-principal a client sends before the request reaches us.
//
// So this is trustworthy *in production, behind SWA*. Run the Functions host
// directly on port 7071 and nothing sets the header -- which is why the gate
// is also a route rule in staticwebapp.config.json, not this check alone.
// ---------------------------------------------------------------------------
function getPrincipal(request) {
  const header = request.headers.get('x-ms-client-principal')
  if (!header) return null
  try {
    const parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    return parsed && parsed.userId ? parsed : null
  } catch {
    // A malformed header is not an authenticated user. Treat it as anonymous
    // rather than throwing a 500 at someone holding a stale cookie.
    return null
  }
}

// ---------------------------------------------------------------------------
// Validation. Every rule here mirrors a constraint the table already enforces
// (PK_Loads, CK_Loads_miles, CK_Loads_rate, CK_Loads_status) plus the column
// widths. The database is still the backstop -- this exists so a bad request
// comes back as a 400 saying which field is wrong, instead of a 500 carrying
// a SQL constraint name nobody outside this repo can read.
// ---------------------------------------------------------------------------
function validate(body) {
  const errors = []

  // Values arrive as strings from an HTML form even when type="number", and
  // this route is reachable by anything else that can send JSON. Coerce
  // deliberately, and reject whatever does not survive it.
  const text = (v) => (typeof v === 'string' ? v.trim() : '')

  const id = text(body.id)
  const origin = text(body.origin)
  const destination = text(body.destination)
  const equipment = text(body.equipment)
  const miles = Number(body.miles)
  const rate = Number(body.rate)

  if (!id) errors.push('Load # is required.')
  else if (id.length > 20) errors.push('Load # cannot be longer than 20 characters.')

  if (!origin) errors.push('Origin is required.')
  else if (origin.length > 100) errors.push('Origin cannot be longer than 100 characters.')

  if (!destination) errors.push('Destination is required.')
  else if (destination.length > 100) errors.push('Destination cannot be longer than 100 characters.')

  // Number('') is 0 and Number('abc') is NaN, so an empty field and a
  // non-numeric one both have to be caught before the range check.
  if (!Number.isInteger(miles) || miles <= 0) errors.push('Miles must be a whole number above zero.')
  if (!Number.isFinite(rate) || rate < 0) errors.push('Rate must be zero or more.')

  if (!EQUIPMENT.includes(equipment)) {
    errors.push(`Equipment must be one of: ${EQUIPMENT.join(', ')}.`)
  }

  return { errors, load: { id, origin, destination, miles, rate, equipment } }
}

async function handleGet() {
  const pool = await getPool()

  // Explicit column list: it keeps the shape stable if someone adds a
  // column to the table later.
  const result = await pool.request().query(`
    SELECT id, origin, destination, miles, rate, equipment, status,
           driver_code, delivered_date
    FROM dbo.Loads
    ORDER BY id;
  `)

  return {
    jsonBody: result.recordset.map(rowToLoad),
    headers: {
      // The data changes rarely and a stale board is worse than a slow
      // one, so no caching. Revisit if this ever gets traffic.
      'Cache-Control': 'no-store',
    },
  }
}

async function handlePost(request, context) {
  const principal = getPrincipal(request)
  if (!principal) {
    return { status: 401, jsonBody: { error: 'Sign in to add a load.' } }
  }

  let body
  try {
    body = await request.json()
  } catch {
    return { status: 400, jsonBody: { error: 'Expected a JSON body.' } }
  }

  const { errors, load } = validate(body || {})
  if (errors.length) {
    return { status: 400, jsonBody: { error: errors.join(' ') } }
  }

  const pool = await getPool()

  // Parameterised, every value. Never build this string by interpolation --
  // a destination of  x'); DROP TABLE dbo.Loads; --  is an ordinary thing for
  // a text input to contain, and the only reason it is harmless here is that
  // .input() sends it as data and never as SQL.
  //
  // Types are declared rather than left to the driver to guess: an NVarChar
  // guessed as VarChar mangles a non-ASCII city name, and a Decimal without
  // precision rounds without saying so.
  //
  // status is hard-coded, not read from the body. A load that has just been
  // created is Available by definition, and accepting the value from the
  // client would let a POST claim Delivered with no driver attached --
  // something CK_Loads_delivered would reject as a 500 rather than an answer.
  const result = await pool
    .request()
    .input('id', sql.VarChar(20), load.id)
    .input('origin', sql.NVarChar(100), load.origin)
    .input('destination', sql.NVarChar(100), load.destination)
    .input('miles', sql.Int, load.miles)
    .input('rate', sql.Decimal(10, 2), load.rate)
    .input('equipment', sql.NVarChar(50), load.equipment)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.Loads WHERE id = @id)
        THROW 50409, 'duplicate', 1;

      INSERT INTO dbo.Loads (id, origin, destination, miles, rate, equipment, status)
      OUTPUT inserted.id, inserted.origin, inserted.destination, inserted.miles,
             inserted.rate, inserted.equipment, inserted.status,
             inserted.driver_code, inserted.delivered_date
      VALUES (@id, @origin, @destination, @miles, @rate, @equipment, N'Available');
    `)

  // Attribution is logged, not stored: dbo.Loads has no created_by column and
  // adding one is DDL against Millstream. The log answers "who added this"
  // today, and the column is a small migration away when it needs to be a
  // thing the board can show.
  context.log(`Load ${load.id} created by ${principal.userDetails} (${principal.identityProvider})`)

  // 201 with the row the database actually wrote, not the row that was sent.
  // They differ: status was filled in here, and DECIMAL(10,2) has already
  // rounded the rate. What is stored is what the board should render.
  return {
    status: 201,
    jsonBody: rowToLoad(result.recordset[0]),
    headers: { 'Cache-Control': 'no-store' },
  }
}

app.http('loads', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'loads',
  handler: async (request, context) => {
    try {
      return request.method === 'POST'
        ? await handlePost(request, context)
        : await handleGet()
    } catch (err) {
      // A duplicate id is the caller's answer, not a server fault: the load is
      // already on the board. THROW 50409 above and PK_Loads underneath it
      // both land here, so the race between the EXISTS check and the INSERT
      // has the same ending -- two simultaneous posts of one id give one 201
      // and one 409, never two rows.
      if (err.number === 50409 || err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'That load number already exists.' } }
      }

      // Log the real error server-side; return a generic one. A SQL error
      // message can name the server, the database and the login, and none of
      // that belongs in a browser.
      context.error(`${request.method} /api/loads failed:`, err)
      return {
        status: 500,
        jsonBody: { error: 'Could not load data.' },
      }
    }
  },
})
