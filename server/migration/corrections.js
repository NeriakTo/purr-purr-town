// 回傳真正位於循環上的節點；指向循環的尾鏈不屬於循環。
export function correctionCycleMembers(edges) {
  const cycles = new Set()
  for (const start of edges.keys()) {
    const route = []
    let next = start
    while (next !== null && next !== undefined && !route.includes(next)) {
      route.push(next)
      next = edges.get(next)
    }
    const offset = route.indexOf(next)
    if (offset >= 0) {
      for (const member of route.slice(offset)) cycles.add(member)
    }
  }
  return cycles
}
export function correctionMatches(transactions, target) {
  if (target === null || target === undefined) return []
  const matches = []
  transactions.forEach((transaction, index) => {
    if (transaction.id != null && transaction.id === target) matches.push(index)
  })
  return matches
}

export function correctionTargets(transactions) {
  return new Map(transactions.map((transaction, index) => {
    const matches = correctionMatches(transactions, transaction.correctedTxId)
    return [index, matches.length === 1 ? matches[0] : null]
  }))
}

