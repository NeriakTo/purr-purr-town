import { withClassReadSnapshot } from './snapshot.js'
import { buildStateResponse, queryClassState } from './state.js'
import { exceedsChangesThreshold, queryChangedOperations, queryChangedTransactions } from './streams.js'
import { queryClassVersionRows } from './version-rows.js'

export function loadClassChanges(pool, config, classId, sinceSeq, hooks) {
  return withClassReadSnapshot(pool, config, classId, hooks, async function queryChanges(client, classSeq) {
    const full = sinceSeq === 0 || sinceSeq > classSeq
      || await exceedsChangesThreshold(client, classId, sinceSeq, config.read.changesFullThreshold)
    if (full) return { full, state: await queryClassState(client, classId, classSeq) }
    const rows = await queryClassVersionRows(client, classId, sinceSeq)
    const transactions = await queryChangedTransactions(client, classId, sinceSeq)
    const operations = await queryChangedOperations(client, classId, sinceSeq)
    return { full, state: { classSeq, rows }, transactions, operations }
  })
}

export function buildChangesResponse(clock, { full, state, transactions, operations }) {
  const response = buildStateResponse(clock, state)
  if (full) return { ...response, full }
  return { ...response, full, transactions, operations }
}
