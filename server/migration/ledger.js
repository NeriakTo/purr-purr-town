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

function earnedDelta(transaction, kind, resolvedRootKind) {
  if (!Number.isFinite(transaction.amount)) return null
  const earnedKind = earnedKindFor(transaction, kind, resolvedRootKind)
  return earnedKind === 'legacy_general' ? transaction.amount : 0
}

function earnedKindFor(transaction, kind, resolvedRootKind) {
  if (kind === 'correction') return resolvedRootKind
  if (kind !== 'legacy_orphan_correction') return kind
  const reason = typeof transaction.reason === 'string' ? transaction.reason.replace(/^(?:(?:撤銷|修正)：)+/, '') : null
  return rootKind(reason)
}

export function legacyTransactionFacts(transactions, edges, cycles) {
  const roots = new Map()
  const rootKinds = transactions.map(function classifyRoot(transaction) {
    if (transaction.type === 'correction') return null
    return rootKind(transaction.reason)
  })
  return transactions.map(function describeTransaction(transaction, index) {
    const isCorrection = transaction.type === 'correction'
    const rootIndex = isCorrection ? correctionRootIndex(transactions, edges, cycles, index, roots) : null
    const root = transactions[rootIndex]
    const chainBroken = isCorrection && rootIndex === null
    const kind = kindFor(rootKinds[index], chainBroken)
    const date = root ? root.date : transaction.date
    const dateIsValid = taipeiTimestamp(transaction.date) !== null
    const effectiveAt = dateIsValid && taipeiTimestamp(date) !== null ? date : null
    const delta = earnedDelta(transaction, kind, rootKinds[rootIndex])
    return { kind, rootIndex, chainBroken, effectiveAt, earnedDelta: delta }
  })
}

function kindFor(ownRootKind, chainBroken) {
  if (ownRootKind !== null) return ownRootKind
  if (chainBroken) return 'legacy_orphan_correction'
  return 'correction'
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

export function sumNumeric(values) {
  if (!values.every(Number.isFinite)) return null
  const sum = values.reduce((total, value) => total + value, 0)
  return Number.isFinite(sum) ? sum : null
}

export function accountFields(bank, transactions, facts, legacyEarned) {
  const cached = bank.totalEarned !== undefined
  return {
    balance: bank.balance === undefined ? 0 : bank.balance,
    total_earned: cached ? bank.totalEarned : legacyEarned,
    total_earned_source: cached ? 'legacy_stored' : 'legacy_recomputed',
    ledger_sum: sumNumeric(transactions.map(transaction => transaction.amount)),
    legacy_earned_recomputed: legacyEarned,
    earned_delta_sum: sumNumeric(facts.map(fact => fact.earnedDelta)),
  }
}

export function openingAdjustmentFor(path, account) {
  const raw = openingAdjustmentRaw(account)
  if (!Object.values(raw).every(Number.isFinite)) return null
  const amount = account.balance - account.ledger_sum
  const earnedDelta = account.total_earned - account.earned_delta_sum
  if (!Number.isFinite(amount) || !Number.isFinite(earnedDelta)) return null
  if (amount === 0 && earnedDelta === 0) return null
  return { path, amount, earned_delta: earnedDelta, reason: '轉換期初調整' }
}

export function openingAdjustmentFields(adjustment, cutoverDate, studentId) {
  return {
    student_id: studentId,
    kind: 'migration_opening_adjustment',
    amount: adjustment.amount,
    earned_delta: adjustment.earned_delta,
    reason: adjustment.reason,
    occurred_at: `${cutoverDate}T00:00:00+08:00`,
    transaction_type: 'opening_adjustment',
    effective_at: null,
    semester: null,
    root_transaction_id: null,
    corrected_transaction_id: null,
    balance_after: null,
    voided: false,
    chain_broken: false,
    legacy_semantics: true,
    origin: 'migration',
    op_id: null,
  }
}

export function openingAdjustmentRaw({ balance, ledger_sum, total_earned, earned_delta_sum }) {
  return { balance, ledger_sum, total_earned, earned_delta_sum }
}

export function reportAccountDrift(path, account, adjustmentEnabled, error, notice) {
  const { balance, ledger_sum, total_earned, legacy_earned_recomputed } = account
  if (!adjustmentEnabled && balance !== ledger_sum) {
    error('BALANCE_DRIFT', path, { stored: balance, computed: ledger_sum })
  }
  if (total_earned !== legacy_earned_recomputed) {
    const report = adjustmentEnabled ? notice : error
    report('TOTAL_EARNED_DRIFT', path, { stored: total_earned, computed: legacy_earned_recomputed })
  }
}
