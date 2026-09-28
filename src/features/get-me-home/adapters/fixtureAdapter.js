import roster from '../fixtures/roster.json'

// ---------------------------------------------------------------------------
// The sample roster, served the way a real adapter would serve a real one:
// asynchronously, a little late, and cancellable.
//
// The delay is deliberate. With data that arrives instantly the loading
// state is never seen, and so never designed -- and on the host it will be
// seen every time the tab opens.
//
// A real adapter looks like this with the body swapped for a request, e.g.
//
//   async loadRoster({ organizationId, signal }) {
//     const { data } = await api.get(`/get-me-home/roster`, { params: { organizationId }, signal })
//     return data            // already in the contract's shape, or mapped into it here
//   }
// ---------------------------------------------------------------------------
const DELAY_MS = 400

export const fixtureAdapter = {
  async loadRoster({ signal } = {}) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, DELAY_MS)
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('The roster request was cancelled.', 'AbortError'))
        })
      }
    })
    // A copy, so nothing downstream can change the sample for the next load.
    return structuredClone(roster)
  },
}
