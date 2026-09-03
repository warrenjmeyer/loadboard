// ---------------------------------------------------------------------------
// Formatters for the settlement.
//
// One place, because a pay statement that formats $1,602.5 in one column and
// $1,602.50 in another looks broken even when the arithmetic is right.
// ---------------------------------------------------------------------------

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const miles = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// Rate per mile wants more precision than money: at two decimals every rate
// between $0.615 and $0.624 prints as $0.62 and the column stops telling you
// anything.
const rate = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

export function formatMoney(value) {
  return usd.format(value ?? 0)
}

export function formatMiles(value) {
  return miles.format(value ?? 0)
}

export function formatRate(value) {
  return `$${rate.format(value ?? 0)}`
}

// A percentage driver's pay_rate is stored as the fraction it is -- 0.68, not
// 68 -- because that is the number the pay is actually multiplied by. Showing
// it as "68%" is a presentation choice, so the conversion lives here and not
// in the database.
//
// One decimal place: contracts are written at 68% and 72.5%, and trailing
// ".0%" on every whole number is noise.
const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
})

export function formatPercent(fraction) {
  return percent.format(fraction ?? 0)
}

// Dates arrive as plain 'YYYY-MM-DD'. Splitting the string beats new Date(),
// which reads a bare date as UTC midnight and then renders it in local time --
// so a check dated the 28th displays as the 27th anywhere west of Greenwich.
// A pay date that is off by one is a support call.
export function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}
