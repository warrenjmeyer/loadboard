// ---------------------------------------------------------------------------
// Sorting the load board.
//
// A separate file from App.jsx for one reason: this is the only part of the
// sort with any decisions in it, and here it can be tested directly by
// sortLoads.test.js. A comparator buried in a component can only be checked by
// rendering the component and reading the rows back out.
//
// Nothing in here touches React. Data in, order out.
// ---------------------------------------------------------------------------

// The value a column sorts on. Usually just the field, with one exception:
// $/mi is not stored anywhere. LoadRow computes it for display, so sorting has
// to compute the same thing -- sort by a number the screen does not show and
// the order looks wrong to the person reading it.
export function sortValue(load, key) {
  if (key === 'rpm') return load.rate / load.miles
  return load[key]
}

// A comparator answers ONE question about TWO rows: which comes first?
// Negative means a, positive means b, zero means it does not matter. That is
// the whole contract -- Array.sort() calls this repeatedly and does the rest.
export function compareLoads(a, b, key, dir) {
  const av = sortValue(a, key)
  const bv = sortValue(b, key)

  // Empty cells sink, in BOTH directions, which is why this runs before the
  // direction flip at the bottom. The Driver column is empty for every load
  // that is not delivered -- and empty for ALL of them when nobody is signed
  // in, because the API strips driverCode from anonymous responses. Letting
  // "descending" float a block of blank cells to the top would bury the rows
  // somebody clicked the header to see.
  const aEmpty = av === null || av === undefined || av === ''
  const bEmpty = bv === null || bv === undefined || bv === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  // Two kinds of column, two kinds of comparison. Subtracting strings gives
  // NaN, and a comparator that returns NaN does not throw -- the browser just
  // leaves the order alone, so the click looks broken rather than wrong.
  let result
  if (typeof av === 'number' && typeof bv === 'number') {
    result = av - bv
  } else {
    // numeric: true so L-9999 sorts before L-10412 rather than after it.
    // Plain text collation compares "9" to "1" and stops there.
    result = String(av).localeCompare(String(bv), undefined, { numeric: true })
  }

  return dir === 'asc' ? result : -result
}

// The sorted copy. A COPY because Array.sort() reorders in place, and the
// array being sorted here is React state -- mutating it would change what is
// on screen without React ever hearing about it.
export function sortLoads(loads, key, dir) {
  if (!key) return loads
  return [...loads].sort((a, b) => compareLoads(a, b, key, dir))
}
