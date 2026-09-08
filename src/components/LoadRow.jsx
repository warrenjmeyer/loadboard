import { Link } from 'react-router-dom'

// A presentational component: data in, markup out, no state, no side effects.
// Notice it is just a function that returns markup. That is the whole idea of
// a React component -- the closest ColdFusion analog is a custom tag or a
// <cf_> module that takes attributes and emits HTML.
export default function LoadRow({ load }) {
  const rpm = (load.rate / load.miles).toFixed(2)

  return (
    <tr>
      {/* The load number is the way in to the load. A <Link> and not an <a>:
          an anchor would reload the whole app, throwing away the loads already
          fetched and asking /api/me all over again. */}
      <td className="mono">
        <Link to={`/loads/${encodeURIComponent(load.id)}`}>{load.id}</Link>
      </td>
      <td>{load.origin}</td>
      <td>{load.destination}</td>
      <td className="num">{load.miles.toLocaleString()}</td>
      <td className="num">${load.rate.toLocaleString()}</td>
      <td className="num">${rpm}</td>
      <td>{load.equipment}</td>
      <td>
        {/* Template literals build the class name. In JSX the attribute is
            `className`, not `class`, because `class` is a reserved word in
            JavaScript. Same reason `for` becomes `htmlFor`. */}
        <span className={`badge badge-${load.status.toLowerCase()}`}>{load.status}</span>
      </td>
      {/* Only a delivered load has a driver, and the database enforces that --
          so an empty cell here means "not delivered", never "we lost track of
          who ran it". */}
      {/* No ?date= here on purpose: this link means "show me this driver's
          pay", not a specific period. Settlement.jsx canonicalises the bare
          URL to the newest statement, which is the right default. */}
      <td className="mono">
        {load.driverCode ? (
          <Link to={`/settlements/${encodeURIComponent(load.driverCode)}`}>
            {load.driverCode}
          </Link>
        ) : (
          ''
        )}
      </td>
    </tr>
  )
}
