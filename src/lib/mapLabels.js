// ---------------------------------------------------------------------------
// Which labels the map is allowed to draw.
//
// The reference layer -- the grey dots and names behind the stops -- is
// context. It exists so the eye has something to hold on to, and the moment
// it competes with the stops it has stopped doing its job. Two ways it does
// compete, both seen on a real load page:
//
//   A NAME THAT IS NOT A PLACE NAME. The map assumed every Geotab zone is
//   called something like "DUBUQUE, IA", because that is what
//   geotab-add-zones.ps1 -FromLanes creates. The demo database also holds
//   zones named by street address -- "4200 Mercy Dr, Dubuque, IA 52001, Usa"
//   -- which say nothing at state scale and are four times too long.
//
//   TWO LABELS IN THE SAME PLACE. Towns cluster. Two names an inch apart on
//   the ground are two names on top of each other on the page, and the
//   reader gets a smear rather than either one.
//
// Both are decided here rather than in the component, because they are
// arithmetic about text and can be tested without rendering anything.
// ---------------------------------------------------------------------------

// Is this the name of a town, as this app writes them? "DUBUQUE, IA" yes;
// "4200 Mercy Dr, Dubuque, IA 52001, Usa" no.
//
// The digit test does most of the work -- addresses have numbers and towns
// do not -- and the shape test catches the rest: one comma, then a two
// letter state. Anything else is still a real place, it just cannot be said
// in the space available, so the map draws its dot without a name.
export function looksLikeTown(name) {
  const s = String(name || '').trim()
  if (!s || s.length > 28) return false
  if (/\d/.test(s)) return false
  return /^[^,]+,\s*[A-Za-z]{2}$/.test(s)
}

// Roughly how wide a label is, in the SVG's units. A real measurement needs
// a browser; this is the average width of a character at the size these are
// drawn, which is enough to keep two names apart.
const CHAR_W = 5.2
const LINE_H = 11

export function labelBox(x, y, text, { anchor = 'start', charWidth = CHAR_W, lineHeight = LINE_H } = {}) {
  const width = String(text || '').length * charWidth
  const left = anchor === 'middle' ? x - width / 2 : x
  return {
    x1: left,
    x2: left + width,
    y1: y - lineHeight,
    y2: y,
  }
}

function overlaps(a, b, pad = 1) {
  return !(a.x2 + pad < b.x1 || b.x2 + pad < a.x1 || a.y2 + pad < b.y1 || b.y2 + pad < a.y1)
}

// Keep the labels that fit; drop the ones that would land on something
// already drawn.
//
// Greedy and in order, so the caller decides what matters: the stops go in
// `reserved` and always win, and the reference cities are offered nearest
// first, so the ones nearest the lane are the ones that survive. A dropped
// label takes its dot with it -- an unlabelled speck beside a labelled one
// is clutter, not context.
export function withoutCollisions(candidates, { reserved = [] } = {}) {
  const taken = [...reserved]
  const kept = []
  for (const c of candidates || []) {
    const box = c.box || labelBox(c.x, c.y, c.label)
    if (taken.some((t) => overlaps(t, box))) continue
    taken.push(box)
    kept.push(c)
  }
  return kept
}
