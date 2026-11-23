import { expect, it } from 'vitest'
import {
  chunkLookupIds, classifyReceiptSequence, observeSubmitSequence, retryDelaySeconds, transitionQueueState,
} from './queue-rules.js'
import committed from '../../../docs/revamp/frontend-queue/samples/submit-committed.json'
import batchUndo from '../../../docs/revamp/frontend-queue/samples/submit-batch-undo.json'

it('退避秒數依次數遞增並採用限流秒數', () => {
  expect([1, 2, 3, 4, 5, 6, 7].map(attempt => retryDelaySeconds(attempt))).toEqual([2, 4, 8, 16, 32, 60, 60])
  expect(retryDelaySeconds(8, 30)).toBe(30)
  expect(retryDelaySeconds(1, 0)).toBe(0)
})

it('查詢編號依原順序分成最多五十筆並保留重複', () => {
  const ids = Object.freeze(Array.from({ length: 101 }, (_, index) => String(index % 50)))
  const chunks = chunkLookupIds(ids)
  expect(chunks.map(group => group.length)).toEqual([50, 50, 1])
  expect(chunks.flat()).toEqual(ids)
  expect(chunkLookupIds([])).toEqual([])
})

it('狀態只接受圖上轉移及定案與接手補充規則', () => {
  const edges = [
    [null, 'persisted', 'queued'],
    ['queued', 'send', 'sending'], ['sending', 'retry', 'queued'], ['sending', 'takeover', 'queued'],
    ['sending', 'pause', 'paused'], ['paused', 'resume', 'queued'], ['paused', 'cancel', 'cancelling'],
    ['queued', 'cancel', 'cancelling'], ['sending', 'cancel', 'cancelling'], ['sending', 'report_unsaved', 'cancelling'],
    ['cancelling', 'keep_cancelling', 'cancelling'], ['cancelling', 'takeover', 'cancelling'],
    ['queued', 'takeover', 'queued'], ['paused', 'takeover', 'paused'],
    ['sending', 'settled', 'removed'], ['sending', 'invalid_op_id', 'removed'],
    ['queued', 'invalid_op_id', 'removed'], ['paused', 'invalid_op_id', 'removed'],
    ['cancelling', 'invalid_op_id', 'removed'], ['cancelling', 'settled', 'removed'],
    ['queued', 'settled', 'removed'], ['paused', 'settled', 'removed'],
  ]
  for (const [state, event, next] of edges) {
    expect(transitionQueueState(state, event), `${state} / ${event}`).toEqual({ ok: true, state: next })
  }
  for (const [state, event] of [['queued', 'pause'], ['cancelling', 'pause'], ['removed', 'send'], ['sending', 'future']]) {
    expect(transitionQueueState(state, event)).toEqual({ ok: false, error: 'invalid_transition' })
  }
})

it('單筆序號區分無效、較舊、相同、連號與跳號', () => {
  const cursors = Object.freeze({ maxSeenSeq: 8, appliedSeq: 5 })
  for (const seq of [null, undefined, -1, 1.5, '9', Infinity]) {
    expect(classifyReceiptSequence(seq, cursors)).toEqual({ kind: 'ignored', ...cursors })
  }
  expect(classifyReceiptSequence(4, cursors)).toEqual({ kind: 'old', ...cursors })
  expect(classifyReceiptSequence(5, cursors)).toEqual({ kind: 'old', ...cursors })
  expect(classifyReceiptSequence(6, cursors)).toEqual({ kind: 'next', ...cursors, applyThroughSeq: 6 })
  expect(classifyReceiptSequence(10, cursors)).toEqual({ kind: 'gap', maxSeenSeq: 10, appliedSeq: 5, readSinceSeq: 5 })
})

it('連續兩張收據各在完成套用後推進一次', () => {
  let cursors = { maxSeenSeq: 1, appliedSeq: 1 }
  for (const receipt of committed.receipts) {
    const decision = classifyReceiptSequence(receipt.class_seq, cursors)
    expect(decision).toMatchObject({ kind: 'next', applyThroughSeq: receipt.class_seq, appliedSeq: cursors.appliedSeq })
    cursors = { maxSeenSeq: decision.maxSeenSeq, appliedSeq: decision.applyThroughSeq }
  }
  expect(cursors).toEqual({ maxSeenSeq: 3, appliedSeq: 3 })
})

it('整批撤銷的操作收據跳號並以原起點補讀', () => {
  const [receipt] = batchUndo.receipts
  const undone = receipt.result.items.filter(entry => entry.outcome === 'undone').length
  expect(undone).toBeGreaterThan(0)
  const appliedSeq = receipt.class_seq - undone - 1
  expect(classifyReceiptSequence(receipt.class_seq, { maxSeenSeq: appliedSeq, appliedSeq }))
    .toEqual({ kind: 'gap', maxSeenSeq: receipt.class_seq, appliedSeq, readSinceSeq: appliedSeq })
})

it('提交回應外層只更新看過的最大序號', () => {
  const cursors = Object.freeze({ maxSeenSeq: 4, appliedSeq: 2 })
  expect(observeSubmitSequence(batchUndo.class_seq, cursors)).toEqual({ maxSeenSeq: batchUndo.class_seq, appliedSeq: 2 })
  expect(observeSubmitSequence(3, cursors)).toEqual(cursors)
  expect(observeSubmitSequence(null, cursors)).toEqual(cursors)
  expect(observeSubmitSequence(null, cursors)).not.toBe(cursors)
})
