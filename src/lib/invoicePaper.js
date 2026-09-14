// ---------------------------------------------------------------------------
// What an invoice says beyond the money: the docks behind each load line, and
// the paper attached to it.
//
// Two facts the invoice document needs and the API returns flat:
//
//   * A customer's accounts payable department does not search for our load
//     number. It searches for THEIR purchase order, and on a multi-stop load
//     there is one per dock -- dbo.LoadStops.reference_no. The single
//     reference_no on dbo.Loads is only the first stop's, which is the wrong
//     number to print on a load that delivered to three consignees.
//   * AP will not pay without the signed proof of delivery. dbo.LoadDocuments
//     names it, and a POD signed at a dock carries that stop's id.
//
// Flattening those into one list per load is pure rearranging, so it lives
// here where it can be tested, rather than inside the component that prints
// it. Nothing here fetches, formats or renders.
// ---------------------------------------------------------------------------

const POD = 'POD'

// The invoice payload -> one entry per load, in the order its lines arrived,
// each carrying its line haul, its charges, its docks and its paper.
//
// A load whose line haul was billed on an EARLIER invoice still appears here
// when one of its charges is a straggler: linehaul is null and the document
// says so. That is why the grouping is driven by lines and not by stops.
export function groupInvoice(invoice) {
  const lines = invoice?.lines || []
  const stops = invoice?.stops || []
  const documents = invoice?.documents || []

  const stopsByLoad = new Map()
  for (const s of [...stops].sort((a, b) => Number(a.seq) - Number(b.seq))) {
    if (!stopsByLoad.has(s.loadId)) stopsByLoad.set(s.loadId, [])
    stopsByLoad.get(s.loadId).push(s)
  }

  const docsByLoad = new Map()
  for (const d of documents) {
    if (!docsByLoad.has(d.loadId)) docsByLoad.set(d.loadId, [])
    docsByLoad.get(d.loadId).push(d)
  }

  const byLoad = new Map()
  for (const line of lines) {
    if (!byLoad.has(line.loadId)) {
      byLoad.set(line.loadId, {
        loadId: line.loadId,
        linehaul: null,
        charges: [],
        deliveredDate: line.deliveredDate,
        referenceNo: line.referenceNo,
        miles: line.miles,
        stops: [],
        documents: [],
        pods: [],
        showStops: false,
      })
    }
    const g = byLoad.get(line.loadId)
    if (line.lineType === 'LINEHAUL') g.linehaul = line
    else g.charges.push(line)
  }

  for (const g of byLoad.values()) {
    g.documents = docsByLoad.get(g.loadId) || []
    g.pods = g.documents.filter((d) => d.docType === POD)
    g.stops = (stopsByLoad.get(g.loadId) || []).map((s) => ({
      ...s,
      // A POD with no stop_id belongs to the load, not to this dock: the
      // driver photographed it in the truck stop afterwards. It is counted
      // in g.pods either way, but it does not mark a stop it never named.
      pod: g.pods.find((d) => d.stopId != null && d.stopId === s.stopId) || null,
    }))

    // A stop line earns its place on the page only when it says something the
    // lane above it does not. Two stops that are the origin and destination
    // with no dock name, no reference and no paper print the lane twice and
    // tell the reader nothing.
    g.showStops = g.stops.some((s) => s.name || s.referenceNo || s.pod)
  }

  return [...byLoad.values()]
}

// The loads on this invoice that were hauled by us and have no proof of
// delivery attached. Dispatch's problem, not the customer's -- this is why
// AP will ring in three weeks -- so it is shown on screen and never printed.
export function loadsMissingPod(groups) {
  return groups.filter((g) => g.linehaul && g.pods.length === 0).map((g) => g.loadId)
}

// The loads whose POD is attached, for the line that prints under the totals
// telling AP what came with the invoice.
export function loadsWithPod(groups) {
  return groups.filter((g) => g.pods.length > 0).map((g) => g.loadId)
}
