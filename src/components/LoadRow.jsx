// A presentational component: data in, markup out, no state, no side effects.
// Notice it is just a function that returns markup. That is the whole idea of
// a React component -- the closest ColdFusion analog is a custom tag or a
// <cf_> module that takes attributes and emits HTML.
export default function LoadRow({ load }) {
  const rpm = (load.rate / load.miles).toFixed(2)

  return (
    <tr>
      <td className="mono">{load.id}</td>
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
      <td className="mono">
        {load.driverCode ? <a href={`?id=${load.driverCode}`}>{load.driverCode}</a> : ''}
      </td>
    </tr>
  )
}
