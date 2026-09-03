// ---------------------------------------------------------------------------
// The carrier. Hardcoded, and stated plainly rather than hidden.
//
// In the ColdFusion original this came from the payroll system, which this app
// has no equivalent of. Inventing a table to hold one address would be worse
// than one exported object: it would look like configuration nobody can
// actually configure.
//
// It lives here rather than in a page because both statements print it -- the
// company driver's and the owner/operator's -- and a masthead that says
// something different depending on which document you opened would be a bug
// nobody notices until a driver asks.
// ---------------------------------------------------------------------------
export const COMPANY = {
  name: 'Millstream',
  address: '2633 Jackson Street',
  city: 'Dubuque',
  state: 'IA',
  postalCode: '52001',
}
