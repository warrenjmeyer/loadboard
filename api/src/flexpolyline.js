// ---------------------------------------------------------------------------
// HERE's flexible polyline, decoded.
//
// A route's geometry comes back as one string -- a few hundred coordinates
// squeezed into a few hundred characters -- and this turns it back into
// pairs of degrees. It is decoded HERE, on the server, rather than in the
// browser, so the page receives plain numbers and carries no decoder.
//
// THE FORMAT, in the order it has to be read:
//
//   * Every character is six bits, indexed into a 64-character alphabet.
//   * Values are unsigned varints: five bits of payload per character, low
//     chunk first, and the sixth bit (0x20) means "another chunk follows".
//   * Signed values are zigzagged first, so that small negative deltas stay
//     small: 7 encodes as 14, -7 as 13.
//   * The string opens with two unsigned varints -- a version, which must be
//     1, and a header saying how many decimal places the coordinates carry
//     and whether there is a third dimension.
//   * Then pairs (or triples) of signed varints. The FIRST is an absolute
//     position; every one after it is a delta from the point before. Lose
//     track of that and the line unwinds from the wrong place, which looks
//     like a route to somewhere else entirely rather than like an error.
//
// Tested against the example in HERE's own specification, which is the only
// way to know this is right rather than merely plausible.
// ---------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const VALUES = (() => {
  const table = new Map()
  for (let i = 0; i < ALPHABET.length; i += 1) table.set(ALPHABET[i], i)
  return table
})()

class FlexPolylineError extends Error {
  constructor(message) {
    super(`flexible polyline: ${message}`)
    this.name = 'FlexPolylineError'
  }
}

// A cursor over the string, handing back one varint at a time.
function reader(encoded) {
  let at = 0
  return {
    done: () => at >= encoded.length,
    unsigned() {
      let result = 0
      let shift = 0
      while (at < encoded.length) {
        const char = encoded[at]
        at += 1
        const value = VALUES.get(char)
        if (value === undefined) throw new FlexPolylineError(`unexpected character ${JSON.stringify(char)}`)
        result += (value & 0x1f) * 2 ** shift
        if ((value & 0x20) === 0) return result
        shift += 5
        if (shift > 60) throw new FlexPolylineError('a value that long is not a coordinate')
      }
      throw new FlexPolylineError('the string ended in the middle of a value')
    },
    signed() {
      const n = this.unsigned()
      // Zigzag, undone: the low bit is the sign, the rest is the magnitude.
      // Arithmetic rather than bitwise, because a long route's absolute
      // first coordinate can exceed what JavaScript's 32-bit operators hold.
      const half = Math.floor(n / 2)
      return (n % 2 === 1) ? -half - 1 : half
    },
  }
}

// encoded -> [[lat, lng], ...]. A third dimension, if the string carries
// one, is read and discarded: this map is flat and an altitude would only
// be a number nobody draws.
function decode(encoded) {
  const text = String(encoded || '')
  if (!text) return []

  const read = reader(text)
  const version = read.unsigned()
  if (version !== 1) throw new FlexPolylineError(`version ${version} is not one this understands`)

  const header = read.unsigned()
  const precision = header & 15
  const thirdDim = (header >> 4) & 7
  const factor = 10 ** precision

  const points = []
  let lat = 0
  let lng = 0
  while (!read.done()) {
    lat += read.signed()
    lng += read.signed()
    if (thirdDim) read.signed()
    points.push([lat / factor, lng / factor])
  }
  return points
}

module.exports = { decode, FlexPolylineError }
