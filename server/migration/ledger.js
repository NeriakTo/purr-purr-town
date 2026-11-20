import { selectedSemester, taipeiTimestamp } from './decisions.js'

function rootKind(reason) {
  if (typeof reason !== 'string') return 'legacy_general'
  if (reason.startsWith('購買')) return 'shop_purchase'
  if (reason.startsWith('使用道具')) return 'item_use'
  return 'legacy_general'
}

function correctionRootIndex(transactions, edges, cycles, index, roots) {
  const chain = []
  let cursor = index
  while (cursor !== null && !roots.has(cursor)) {
    if (transactions[cursor].type !== 'correction') break
    if (cycles.has(cursor)) {
      cursor = null
      break
    }
    chain.push(cursor)
    cursor = edges.get(cursor)
  }
  const root = roots.has(cursor) ? roots.get(cursor) : cursor
  for (const member of chain) roots.set(member, root)
  return root
}

function earnedDelta(transaction, kind, root) {
  if (!Number.isFinite(transaction.amount)) return null
  const earnedKind = earnedKindFor(transaction, kind, root)
  return earnedKind === 'legacy_general' ? transaction.amount : 0
}

function earnedKindFor(transaction, kind, root) {
  if (kind === 'correction') return rootKind(root.reason)
  if (kind !== 'legacy_orphan_correction') return kind
  const reason = typeof transaction.reason === 'string' ? transaction.reason.replace(/^(?:(?:撤銷|修正)：)+/, '') : null
  return rootKind(reason)
}

export function legacyTransactionFacts(transactions, edges, cycles) {
  const roots = new Map()
  return transactions.map(function describeTransaction(transaction, index) {
    const isCorrection = transaction.type === 'correction'
    const rootIndex = isCorrection ? correctionRootIndex(transactions, edges, cycles, index, roots) : null
    const root = transactions[rootIndex]
    const chainBroken = isCorrection && rootIndex === null
    const kind = kindFor(transaction, chainBroken)
    const date = root ? root.date : transaction.date
    const dateIsValid = taipeiTimestamp(transaction.date) !== null
    const effectiveAt = dateIsValid && taipeiTimestamp(date) !== null ? date : null
    return { kind, rootIndex, chainBroken, effectiveAt, earnedDelta: earnedDelta(transaction, kind, root) }
  })
}

function kindFor(transaction, chainBroken) {
  if (chainBroken) return 'legacy_orphan_correction'
  if (transaction.type === 'correction') return 'correction'
  return rootKind(transaction.reason)
}

export function transactionFields(facts, idAt, decisions) {
  return {
    kind: facts.kind,
    root_transaction_id: facts.rootIndex === null ? null : idAt(facts.rootIndex),
    chain_broken: facts.chainBroken,
    earned_delta: facts.earnedDelta,
    effective_at: facts.effectiveAt,
    semester: selectedSemester(facts.effectiveAt, decisions),
    origin: 'migration',
    op_id: null,
  }
}

export function validateTransactionDate(date, decisions, path, error) {
  if (taipeiTimestamp(date) === null) error('INVALID_TRANSACTION_DATE', path, date)
  if (decisions.semesterRule !== 'month') error('UNKNOWN_TRANSACTION_SEMESTER', path)
}
