export function retryDelaySeconds(attempts, retryAfter) {
  if (retryAfter !== undefined) return retryAfter
  if (attempts >= 6) return 60
  return 2 ** Math.max(1, attempts)
}

export function chunkLookupIds(opIds) {
  const groups = []
  for (let offset = 0; offset < opIds.length; offset += 50) {
    groups.push(opIds.slice(offset, offset + 50))
  }
  return groups
}

const transitions = {
  queued: { send: 'sending', cancel: 'cancelling', takeover: 'queued' },
  // 老師可以對任何還沒結清的項目選放棄，送出中的也算（規格 4.6 的表）。
  sending: { retry: 'queued', takeover: 'queued', pause: 'paused', cancel: 'cancelling', report_unsaved: 'cancelling' },
  paused: { resume: 'queued', cancel: 'cancelling', takeover: 'paused' },
  cancelling: { keep_cancelling: 'cancelling', takeover: 'cancelling' },
}

export function transitionQueueState(state, event) {
  if (state === null && event === 'persisted') return { ok: true, state: 'queued' }
  if (Object.hasOwn(transitions, state)) {
    if (event === 'settled' || event === 'invalid_op_id') return { ok: true, state: 'removed' }
    if (Object.hasOwn(transitions[state], event)) return { ok: true, state: transitions[state][event] }
  }
  return { ok: false, error: 'invalid_transition' }
}

function isSequence(value) {
  return Number.isInteger(value) && value >= 0
}

export function observeSubmitSequence(classSeq, { maxSeenSeq, appliedSeq }) {
  return { maxSeenSeq: isSequence(classSeq) ? Math.max(maxSeenSeq, classSeq) : maxSeenSeq, appliedSeq }
}

export function classifyReceiptSequence(classSeq, cursors) {
  const observed = observeSubmitSequence(classSeq, cursors)
  if (!isSequence(classSeq)) return { kind: 'ignored', ...observed }
  if (classSeq <= cursors.appliedSeq) return { kind: 'old', ...observed }
  // 呼叫端須在同一筆交易完成變更套用後，才寫入建議的序號。
  if (classSeq === cursors.appliedSeq + 1) {
    return { kind: 'next', ...observed, applyThroughSeq: classSeq }
  }
  return { kind: 'gap', ...observed, readSinceSeq: cursors.appliedSeq }
}
