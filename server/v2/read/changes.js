import { withClassReadSnapshot } from './snapshot.js'
import { buildStateResponse, queryClassState } from './state.js'
import { exceedsChangesThreshold, queryChangedOperations, queryChangedTransactions } from './streams.js'
import { queryClassVersionRows } from './version-rows.js'

export function loadClassChanges(pool, config, classId, sinceSeq, readTime, hooks) {
  return withClassReadSnapshot(pool, config, classId, hooks, async function queryChanges(client, classSeq) {
    const full = sinceSeq === 0 || sinceSeq > classSeq
      || await exceedsChangesThreshold(client, classId, sinceSeq, config.read.changesFullThreshold)
    if (full) return { full, state: await queryClassState(client, classId, classSeq, readTime) }
    const rows = await queryClassVersionRows(client, classId, sinceSeq)
    const transactions = await queryChangedTransactions(client, classId, sinceSeq)
    const operations = await queryChangedOperations(client, classId, sinceSeq)
    const derived = await queryDerivedData(client, classId, readTime, { sinceSeq, rows, transactions })
    return { full, state: { classSeq, rows, transactions, operations, ...derived } }
  })
}

export function buildChangesResponse(readTime, { full, state }) {
  return { ...buildStateResponse(readTime, state), full }
}
import { queryDerivedData } from './derived.js'
