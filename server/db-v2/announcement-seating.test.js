import { expect, it } from 'vitest'
import { addClass, submit } from './test-support/operations.js'
import { commitOperation } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'
import {
  announcementRow, removeAnnouncement, saveAnnouncement, saveSeating, seatingRow,
} from './test-support/announcement-seating.js'

describeDatabase('公告與座位', () => {
  const database = useTestDatabase()

  it('公告建立、更新、標示移除、同值及重新啟用', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const creation = saveAnnouncement(classId, { color: 'blue', rotation: -30 })
    const announcementId = creation.payload.announcement_id
    const read = () => announcementRow(client, classId, announcementId)
    const first = await commitOperation(client, creation)
    expect(first.changes).toEqual([{
      entity: 'announcement', key: { announcement_id: announcementId }, prev_rev: 0, rev: 1,
      last_op_id: creation.op_id, prev_value: null,
      value: { text: '測試公告', color: 'blue', rotation: -30, removed: false },
    }])
    const fields = { announcement_id: announcementId, text: '更新公告', color: 'green', rotation: 15.5 }
    const update = await commitOperation(client, saveAnnouncement(classId, fields, { rev: 1 }))
    expect(update.changes).toEqual([expect.objectContaining({
      entity: 'announcement', key: { announcement_id: announcementId }, prev_rev: 1, rev: 2,
      value: { text: '更新公告', color: 'green', rotation: 15.5, removed: false },
    })])
    const before = await read()
    expect(before).toMatchObject({ text: '更新公告', color: 'green', rotation: '15.5', rev: 2 })
    const same = await commitOperation(client, saveAnnouncement(classId, fields, { rev: 2 }))
    expect(same.result.noop).toBe(true)
    expect(await read()).toEqual(before)
    const removed = await commitOperation(client, removeAnnouncement(classId, announcementId, { rev: 2 }))
    expect(removed.changes[0]).toMatchObject({ prev_rev: 2, rev: 3, value: { removed: true } })
    const tombstone = await read()
    expect(tombstone).toMatchObject({ removed: true, rev: 3 })
    const repeated = await commitOperation(client, removeAnnouncement(classId, announcementId, { rev: 3 }))
    expect(repeated.result.noop).toBe(true)
    expect(await read()).toEqual(tombstone)
    const restored = await commitOperation(client, saveAnnouncement(classId, { announcement_id: announcementId }, { rev: 3 }))
    expect(restored.changes[0]).toMatchObject({
      prev_value: { text: '更新公告', color: 'green', rotation: 15.5, removed: true },
      value: { text: '測試公告', color: null, rotation: null, removed: false },
    })
    expect(await read()).toMatchObject({ removed: false, rev: 4, color: null, rotation: null })
  })

  it.each([
    ['新建的編號非 v4', { announcement_id: 'imported' }],
    ['空白文字', { text: '' }],
    ['文字超過 500 字', { text: '文'.repeat(501) }],
    ['角度超過範圍', { rotation: 400 }],
    ['多餘鍵', { extra: true }],
    ['缺少版本條件', {}, true],
  ])('公告儲存拒絕%s', async (_name, fields, omitVersion) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const op = saveAnnouncement(classId, fields)
    if (omitVersion) delete op.expect
    expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it.each(['save', 'remove'])('公告 %s 的過期版本保留原列並回現值', async (kind) => {
    const { client } = database()
    const { classId } = await addClass(client)
    const created = saveAnnouncement(classId)
    await commitOperation(client, created)
    const announcementId = created.payload.announcement_id
    const op = kind === 'save'
      ? saveAnnouncement(classId, { announcement_id: announcementId, text: '新內容' }, { rev: 0 })
      : removeAnnouncement(classId, announcementId, { rev: 0 })
    const before = await announcementRow(client, classId, announcementId)
    expect(await submit(client, op)).toMatchObject({
      code: 'STALE_STATE', current: { rev: 1, value: { text: '測試公告', removed: false } },
    })
    expect(await announcementRow(client, classId, announcementId)).toEqual(before)
  })

  it('移除找不到的公告回 NOT_FOUND', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const receipt = await submit(client, removeAnnouncement(classId, 'missing'))
    expect(receipt.code).toBe('NOT_FOUND')
    expect(receipt).not.toHaveProperty('current')
  })

  it('座位表新建、六欄取代、同值與 rev 0 衝突', async () => {
    const { client } = database()
    const { classId, studentIds } = await addClass(client, { students: ['enrolled', 'transferred'] })
    const creation = saveSeating(classId, { seats: { '1,1': studentIds[0] } })
    const first = await commitOperation(client, creation)
    expect(first.changes).toEqual([{
      entity: 'seating', key: { class_id: classId }, prev_rev: 0, rev: 1,
      last_op_id: creation.op_id, prev_value: null, value: creation.payload,
    }])
    const fields = {
      rows: 4, cols: 5, view: 'student', seats: { '2,2': studentIds[1] },
      objects: { '3,3': 'board' }, custom_objects: [{ id: 'board' }],
    }
    const second = await commitOperation(client, saveSeating(classId, fields, { rev: 1 }))
    expect(second.changes[0]).toMatchObject({ prev_rev: 1, rev: 2, value: fields })
    const before = await seatingRow(client, classId)
    expect(before).toMatchObject({ ...fields, rev: 2 })
    expect(before.seats).toEqual(fields.seats)
    const same = await commitOperation(client, saveSeating(classId, fields, { rev: 2 }))
    expect(same.result.noop).toBe(true)
    expect(await submit(client, saveSeating(classId))).toMatchObject({
      code: 'STALE_STATE', current: { rev: 2, value: fields },
    })
    expect(await seatingRow(client, classId)).toEqual(before)
  })

  it.each([
    ['少一鍵', ({ payload }) => { delete payload.view }],
    ['rows 為 0', ({ payload }) => { payload.rows = 0 }],
    ['cols 為 51', ({ payload }) => { payload.cols = 51 }],
    ['seats 是陣列', ({ payload }) => { payload.seats = [] }],
    ['custom_objects 是物件', ({ payload }) => { payload.custom_objects = {} }],
    ['多餘鍵', ({ payload }) => { payload.extra = true }],
    ['缺少版本條件', (op) => { delete op.expect }],
    ['同一學生佔兩個位置', ({ payload }, id) => { payload.seats = { a: id, b: id } }],
  ])('座位表拒絕%s', async (_name, change) => {
    const { client } = database()
    const { classId, studentId } = await addClass(client)
    const op = saveSeating(classId)
    change(op, studentId)
    expect(await submit(client, op)).toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  it('座位學生不存在時回 NOT_FOUND', async () => {
    const { client } = database()
    const { classId } = await addClass(client)
    const receipt = await submit(client, saveSeating(classId, { seats: { a: 'missing' } }))
    expect(receipt.code).toBe('NOT_FOUND')
    expect(receipt).not.toHaveProperty('current')
  })
})
