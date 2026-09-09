const EQUIPMENT_TYPES = ['All', 'Dry Van', 'Reefer', 'Flatbed']

// Every status the board can hold, plus one shortcut. "Current" is what a
// dispatcher means by "the board" -- everything that is not finished -- and
// is the default, because a signed-in account otherwise opens on 145 rows of
// history before reaching the freight that needs a truck today.
export const STATUS_FILTERS = ['Current', 'All', 'Available', 'Covered', 'In Transit', 'Delivered', 'Cancelled']

// ---------------------------------------------------------------------------
// A "controlled" component. Every input's value comes from props, and every
// keystroke calls back up to the parent to change that value. The parent owns
// the truth; this component only displays it and reports intent.
//
// Note this component holds no state of its own. That is deliberate and it is
// the pattern interviewers look for: state lives as high as it needs to and no
// higher, and the leaf components stay dumb and reusable.
// ---------------------------------------------------------------------------
export default function LoadFilters({
  search,
  equipment,
  status,
  onSearchChange,
  onEquipmentChange,
  onStatusChange,
}) {
  return (
    <div className="filters">
      <label>
        Search
        <input
          type="text"
          value={search}
          placeholder="Load #, city, driver, customer"
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </label>

      <label>
        Equipment
        <select value={equipment} onChange={(e) => onEquipmentChange(e.target.value)}>
          {/* Rendering a list = map an array to elements. `key` must be stable
              and unique among siblings -- it is how React matches an element
              to the same element on the next render. Never use the array index
              as a key for a list that can reorder or have items removed. */}
          {EQUIPMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <label>
        Status
        <select value={status} onChange={(e) => onStatusChange(e.target.value)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
