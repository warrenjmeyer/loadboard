import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material'
import StatusChip from './StatusChip.jsx'
import { formatAge, formatDuration, formatMiles, formatShort, formatWhen } from './format.js'
import { STALE_MINUTES } from './planHome.js'

// ---------------------------------------------------------------------------
// Every driver, one row each, most urgent first -- the order comes from
// planRoster, so this never sorts anything itself.
//
// Status is the SECOND column, not the last. It is the one thing a
// dispatcher scans the table for, and on a narrow screen the last column is
// the one that scrolls out of sight.
//
// Each cell is two lines: the fact on top, what it means underneath. A
// dispatcher scanning twenty rows reads the top line; the second line is
// for the row they stopped on. Dates use the short form -- "Tue 6:00 PM" --
// and the full one is in the plan beside the table.
//
// A row is a button in all but tag: click it, or Tab to it and press Enter,
// and the plan beside the table follows.
// ---------------------------------------------------------------------------
export default function RosterTable({ plans, asOf, selectedCode = null, onSelect = () => {} }) {
  const short = (iso) => formatShort(iso, asOf)

  return (
    <TableContainer>
      <Table size="small" aria-label="Drivers and their trip home">
        <TableHead>
          <TableRow>
            <TableCell>Driver</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Now</TableCell>
            <TableCell>Home</TableCell>
            <TableCell align="right">Out</TableCell>
            <TableCell>Home by</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {plans.map((plan) => {
            const selected = plan.driverCode === selectedCode
            return (
              <TableRow
                key={plan.driverCode}
                hover
                selected={selected}
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelect(plan.driverCode)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(plan.driverCode)
                  }
                }}
                sx={{ cursor: 'pointer', '& > td': { verticalAlign: 'top' } }}
              >
                <TableCell>
                  <Two main={plan.name} sub={[plan.unitNo, plan.jobType].filter(Boolean).join(' · ')} strong />
                </TableCell>
                <TableCell><StatusChip status={plan.status} /></TableCell>
                <TableCell><NowCell plan={plan} short={short} /></TableCell>
                <TableCell>
                  <Two
                    main={plan.home ? plan.home.place : '—'}
                    sub={plan.route ? `${formatMiles(plan.route.miles)} mi${plan.route.source === 'estimate' ? ' (est.)' : ''}` : null}
                  />
                </TableCell>
                <TableCell align="right">
                  <Two
                    main={plan.daysOut === null ? '—' : `${plan.daysOut} d`}
                    sub={`of ${plan.maxDaysOut}`}
                    mainColor={plan.daysOut !== null && plan.daysOut > plan.maxDaysOut ? 'error.main' : undefined}
                  />
                </TableCell>
                <TableCell><HomeByCell plan={plan} short={short} /></TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function NowCell({ plan, short }) {
  const s = plan.start
  if (!s) return <Two main="Not reporting" sub={plan.unitNo} />
  if (s.from === 'final-stop') {
    return <Two main={`Delivering ${s.place || ''}`.trim()} sub={`${s.loadId || 'load'} · empty ${short(s.at)}`} />
  }
  const stale = s.ageMinutes !== null && s.ageMinutes > STALE_MINUTES
  return (
    <Two
      main={s.place || 'Last position'}
      sub={s.ageMinutes === null ? 'report time unknown' : `reported ${formatAge(s.ageMinutes)}${s.ageMinutes < 1 ? '' : ' ago'}`}
      subColor={stale ? 'warning.main' : undefined}
    />
  )
}

// The request on top, and underneath what the plan says about it: how late,
// when to start, or -- with no request -- simply when they could be home.
function HomeByCell({ plan, short }) {
  const { schedule, slackSeconds, leaveBy, status, requestedBy } = plan
  if (status === 'home') return <Two main="Home now" />

  const main = requestedBy ? short(requestedBy) : 'No request'
  if (!schedule) return <Two main={main} />
  if (slackSeconds === null) {
    return <Two main={main} sub={`earliest ${short(schedule.arriveAt)}`} />
  }
  if (slackSeconds < 0) {
    return <Two main={main} sub={`${formatDuration(-slackSeconds)} late`} subColor="error.main" />
  }
  return (
    <Two
      main={main}
      sub={`start by ${short(leaveBy)}`}
      subColor={status === 'tight' ? 'warning.main' : undefined}
      title={`Earliest home ${formatWhen(schedule.arriveAt)}`}
    />
  )
}

// Two lines in a cell. Styled through sx and theme tokens only -- no class
// names, no stylesheet -- so it looks the same in any app that has MUI.
function Two({ main, sub = null, strong = false, mainColor, subColor, title }) {
  return (
    <Box title={title}>
      <Box sx={{ typography: 'body2', fontWeight: strong ? 500 : undefined, color: mainColor, whiteSpace: 'nowrap' }}>
        {main}
      </Box>
      {sub && (
        <Box sx={{ typography: 'caption', color: subColor || 'text.secondary', whiteSpace: 'nowrap' }}>
          {sub}
        </Box>
      )}
    </Box>
  )
}
