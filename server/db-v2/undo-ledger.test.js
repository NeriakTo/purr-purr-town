import { expect, test } from 'vitest'
import { useItem } from './test-support/inventory.js'
import { addClass, adjustment, submit, teacher } from './test-support/operations.js'
import { retireProduct, saveProduct } from './test-support/products.js'
import { commitOperation } from './test-support/schoolwork.js'
import { markSubmission } from './test-support/submission-flow.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import { correct, reverse, transactionFrom } from './test-support/transactions.js'
import { buyForUndo, rejectUndoWithoutChanges } from './test-support/undo-ledger.js'
import { setupSubmissionUndo } from './test-support/undo-submissions.js'
import { undo } from './test-support/undo.js'

async function correctionTarget(client) {
  const target = await addClass(client)
  const receipt = await commitOperation(client, adjustment(target, 100))
  return { ...target, rootId: receipt.result.transactions[0], receipt }
}

function undoReceipt(client, { classId }, receipt) {
  return commitOperation(client, undo(classId, receipt.op_id))
}

async function expectAccount(client, target, balance, earned) {
  const { rows } = await client.query(`
    SELECT balance, total_earned FROM ppt.accounts WHERE class_id = $1 AND student_id = $2
  `, [target.classId, target.studentId])
  expect(rows).toEqual([{ balance: String(balance), total_earned: String(earned) }])
}

async function expectShopRows(client, target, status, itemRev, stock, productRev) {
  const { rows } = await client.query(`
    SELECT i.status, i.rev AS item_rev, p.stock, p.rev AS product_rev, p.last_op_id AS product_op
    FROM ppt.inventory_items i JOIN ppt.products p USING (class_id, product_id)
    WHERE i.class_id = $1 AND i.item_id = $2 AND i.product_id = $3
  `, [target.classId, target.itemId, target.productId])
  expect(rows).toMatchObject([{ status, item_rev: itemRev, stock, product_rev: productRev }])
  return rows[0]
}

function expectTxConflict(receipt, rootId, effective, reversed, later) {
  expect(receipt.current).toEqual({
    reason: 'tx_changed_later', transaction_id: rootId, effective_amount: effective, reversed,
    last_op_id: later.op_id, actor: teacher, committed_at: later.committed_at,
  })
}

describeDatabase('撤銷交易更正與道具操作', () => {
  const db = useTestDatabase()

  test('撤銷更正寫反向差額、沿用歸屬時間且只能成立一次', async () => {
    const { client } = db()
    const target = await correctionTarget(client)
    const fixed = await commitOperation(client, correct(target.classId, target.rootId, 100, 80, { reason: '調整原始分數' }))
    const receipt = await undoReceipt(client, target, fixed)
    const root = await transactionFrom(client, target.receipt)
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'correction', amount: '20', earned_delta: '20', root_transaction_id: target.rootId,
      effective_at: root.effective_at, reason: '撤銷調整原始分數',
    })
    expect(receipt.changes.map(({ entity }) => entity)).toEqual(['account'])
    await expectAccount(client, target, 100, 100)
    await rejectUndoWithoutChanges(client, undo(target.classId, fixed.op_id), 'ALREADY_UNDONE')
  })

  test('購買交易的反向更正不改累計加分', async () => {
    const { client } = db()
    const target = await buyForUndo(client, await addClass(client))
    const fixed = await commitOperation(client, correct(target.classId, target.rootId, -3, -8))
    const receipt = await undoReceipt(client, target, fixed)
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'correction', amount: '5', earned_delta: '0', root_transaction_id: target.rootId,
    })
    await expectAccount(client, target, 97, 100)
  })

  test.each([false, true])('撤銷零差額更正，附備註為 %s', async (hasReason) => {
    const { client } = db()
    const target = await correctionTarget(client)
    const fields = hasReason ? { reason: '補記說明' } : {}
    const fixed = await commitOperation(client, correct(target.classId, target.rootId, 100, 100, fields))
    const receipt = await undoReceipt(client, target, fixed)
    expect(receipt.result.undo).toEqual({ target_op_id: fixed.op_id, skipped: [], amount_changed: [] })
    expect(receipt.result.noop).toBe(!hasReason)
    if (hasReason) {
      expect(await transactionFrom(client, receipt)).toMatchObject({
        kind: 'correction', amount: '0', earned_delta: '0', root_transaction_id: target.rootId, reason: '撤銷補記說明',
      })
    } else {
      expect(receipt.result.transactions).toEqual([])
      expect(receipt.changes).toEqual([])
    }
    await expectAccount(client, target, 100, 100)
  })

  test.each(['correction', 'reversal'])('更正之後有人工 %s，回根交易目前值與最後操作', async (kind) => {
    const { client } = db()
    const target = await correctionTarget(client)
    const { classId, rootId } = target
    const fixed = await commitOperation(client, correct(classId, rootId, 100, 80))
    const reversed = kind === 'reversal'
    const later = await commitOperation(client, reversed ? reverse(classId, rootId, 80) : correct(classId, rootId, 80, 90))
    const receipt = await rejectUndoWithoutChanges(client, undo(classId, fixed.op_id), 'UNDO_CONFLICT')
    expectTxConflict(receipt, rootId, reversed ? 0 : 90, reversed, later)
  })

  test('更正之後有系統零元沖回，回已沖回的交易衝突', async () => {
    const { client } = db()
    const { target } = await setupSubmissionUndo(client)
    const { classId } = target
    const missing = await markSubmission(client, target, 'missing')
    const [rootId] = missing.result.transactions
    const fixed = await commitOperation(client, correct(classId, rootId, -20, 0))
    const later = await markSubmission(client, target, 'on_time', 2)
    expect(await transactionFrom(client, later)).toMatchObject({ kind: 'reversal', amount: '0' })
    const receipt = await rejectUndoWithoutChanges(client, undo(classId, fixed.op_id), 'UNDO_CONFLICT')
    expectTxConflict(receipt, rootId, 0, true, later)
  })

  test('撤了較後的更正仍擋住較早的更正', async () => {
    const { client } = db()
    const target = await correctionTarget(client)
    const { classId, rootId } = target
    const older = await commitOperation(client, correct(classId, rootId, 100, 80))
    const newer = await commitOperation(client, correct(classId, rootId, 80, 90))
    const later = await undoReceipt(client, target, newer)
    const rejected = await rejectUndoWithoutChanges(client, undo(classId, older.op_id), 'UNDO_CONFLICT')
    expectTxConflict(rejected, rootId, 80, false, later)
  })

  test('撤購買退點、退道具、補庫存且可接續商品版本', async () => {
    const { client } = db()
    const target = await buyForUndo(client, await addClass(client))
    const { classId, itemId, productId } = target
    await expectShopRows(client, target, 'held', 1, 2, 2)
    const receipt = await undoReceipt(client, target, target.purchase)
    expect(receipt.changes.slice(0, 2)).toEqual([
      { entity: 'inventory_item', key: { item_id: itemId }, prev_rev: 1, rev: 2,
        prev_value: { status: 'held' }, value: { status: 'returned' }, last_op_id: receipt.op_id },
      { entity: 'product', key: { product_id: productId }, prev_rev: 2, rev: 3,
        prev_value: { stock: 2 }, value: { stock: 3 }, last_op_id: receipt.op_id },
    ])
    expect(receipt.changes.map(({ entity }) => entity)).toEqual(['inventory_item', 'product', 'account'])
    const root = await transactionFrom(client, target.purchase)
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'reversal', amount: '3', earned_delta: '0', root_transaction_id: root.transaction_id,
      effective_at: root.effective_at,
    })
    expect((await expectShopRows(client, target, 'returned', 2, 3, 3)).product_op).toBe(receipt.op_id)
    await expectAccount(client, target, 100, 100)
    expect((await submit(client, useItem(classId, itemId))).code).toBe('INVALID_TRANSITION')
    await commitOperation(client, saveProduct(classId, { product_id: productId, name: '改名商品' }, { rev: 3 }))
  })

  test('已使用會擋退購買，撤使用後可再用新編號撤購買', async () => {
    const { client } = db()
    const target = await buyForUndo(client, await addClass(client))
    const used = await commitOperation(client, useItem(target.classId, target.itemId))
    const rejected = await rejectUndoWithoutChanges(client, undo(target.classId, target.purchase.op_id), 'UNDO_CONFLICT')
    expect(rejected.current).toEqual({
      reason: 'item_state_changed', value: { status: 'used' }, rev: 2, last_op_id: used.op_id,
      actor: teacher, committed_at: used.committed_at,
    })
    await undoReceipt(client, target, used)
    await undoReceipt(client, target, target.purchase)
    await expectShopRows(client, target, 'returned', 4, 3, 3)
  })

  test('商品停用且學生轉出仍能撤購買', async () => {
    const { client } = db()
    const target = await buyForUndo(client, await addClass(client))
    await commitOperation(client, retireProduct(target.classId, target.productId, 2))
    await client.query(`
      UPDATE ppt.students SET enrollment_status = 'transferred' WHERE class_id = $1 AND student_id = $2
    `, [target.classId, target.studentId])
    await undoReceipt(client, target, target.purchase)
    await expectShopRows(client, target, 'returned', 2, 3, 4)
    await expectAccount(client, target, 100, 100)
  })

  test.each([-2, 0])('購買金額被更正為 %i，按現額沖回並提示', async (amount) => {
    const { client } = db()
    const target = await buyForUndo(client, await addClass(client))
    const fixed = await commitOperation(client, correct(target.classId, target.rootId, -3, amount))
    const receipt = await undoReceipt(client, target, target.purchase)
    const details = {
      effect_id: null, lineage_id: null, transaction_id: target.rootId, changed_by_op_id: fixed.op_id,
      original_amount: -3, amount,
    }
    expect(receipt.warnings).toEqual([{ code: 'UNDO_EFFECT_MANUALLY_CHANGED', case: 'amount_changed', ...details }])
    expect(receipt.result.undo.amount_changed).toEqual([details])
    expect(await transactionFrom(client, receipt)).toMatchObject({ kind: 'reversal', amount: String(-amount), earned_delta: '0' })
    await expectAccount(client, target, 100, 100)
  })

  test('撤使用寫零元沖回並推進帳戶版本，物品可再用', async () => {
    const { client } = db()
    const target = await buyForUndo(client, await addClass(client))
    const used = await commitOperation(client, useItem(target.classId, target.itemId))
    const receipt = await undoReceipt(client, target, used)
    expect(receipt.changes).toMatchObject([
      { entity: 'inventory_item', prev_rev: 2, rev: 3, prev_value: { status: 'used' }, value: { status: 'held' } },
      { entity: 'account', prev_rev: used.changes[1].rev, rev: used.changes[1].rev + 1, value: { balance: 97 } },
    ])
    expect(await transactionFrom(client, receipt)).toMatchObject({
      kind: 'reversal', amount: '0', earned_delta: '0', root_transaction_id: used.result.transactions[0],
    })
    await expectShopRows(client, target, 'held', 3, 2, 2)
    await expectAccount(client, target, 97, 100)
    await commitOperation(client, useItem(target.classId, target.itemId))
  })

  test('使用後道具狀態被改回持有，拒絕撤使用且資料不變', async () => {
    const { client } = db()
    const target = await buyForUndo(client, await addClass(client))
    const used = await commitOperation(client, useItem(target.classId, target.itemId))
    await client.query(`
      UPDATE ppt.inventory_items SET status = 'held' WHERE class_id = $1 AND item_id = $2
    `, [target.classId, target.itemId])
    const rejected = await rejectUndoWithoutChanges(client, undo(target.classId, used.op_id), 'UNDO_CONFLICT')
    expect(rejected.current).toMatchObject({ reason: 'item_state_changed', value: { status: 'held' } })
  })
})
