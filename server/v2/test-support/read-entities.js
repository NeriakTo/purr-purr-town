import { expect } from 'vitest'
import { saveAnnouncement, saveSeating } from '../../db-v2/test-support/announcement-seating.js'
import { createClass } from '../../db-v2/test-support/class-create.js'
import { saveGroup, updateStudentProfile } from '../../db-v2/test-support/class-student-group.js'
import { saveComment } from '../../db-v2/test-support/comments.js'
import { propose } from '../../db-v2/test-support/confirmations.js'
import { requireRound } from '../../db-v2/test-support/correction-rounds.js'
import { adjustment, submit } from '../../db-v2/test-support/operations.js'
import { payrollDay, saveJob, setDuty } from '../../db-v2/test-support/payroll.js'
import { saveProduct } from '../../db-v2/test-support/products.js'
import { createTask, saveRule } from '../../db-v2/test-support/schoolwork.js'
import { currency, setSetting } from '../../db-v2/test-support/settings.js'
import { purchase } from '../../db-v2/test-support/shop.js'
import { setStatus } from '../../db-v2/test-support/submissions.js'

export async function commitReadOperation(client, op, actor) {
  const receipt = await submit(client, op, actor)
  expect(receipt).toMatchObject({ status: 'committed', code: 'OK' })
  return receipt
}

async function assignTask(client, target, actor) {
  const task = createTask(target.classId)
  await commitReadOperation(client, task, actor)
  return { ...target, taskId: task.payload.task_id }
}

async function buyItem(client, target, actor) {
  const product = saveProduct(target.classId)
  await commitReadOperation(client, product, actor)
  await commitReadOperation(client, adjustment(target, 10), actor)
  return purchase({ ...target, productId: product.payload.product_id })
}

export const readEntities = [
  ['class', 'classes', () => createClass()],
  ['student', 'students', (_, target) => updateStudentProfile(target, { name: '測試學生甲' })],
  ['account', 'accounts', (_, target) => adjustment(target)],
  ['submission', 'submissions', async (client, target, actor) => setStatus(await assignTask(client, target, actor), 'on_time')],
  ['task', 'tasks', (_, target) => createTask(target.classId)],
  ['rule', 'rules', (_, target) => saveRule(target.classId)],
  ['confirmation', 'confirmations', async (client, target, actor) => propose(await assignTask(client, target, actor), 'missing')],
  ['correction', 'corrections', async (client, target, actor) => requireRound(await assignTask(client, target, actor))],
  ['product', 'products', (_, target) => saveProduct(target.classId)],
  ['inventory_item', 'inventory_items', buyItem],
  ['setting', 'settings_entries', (_, target) => setSetting(target.classId, 'currency', currency(), { rev: target.defaultsRev ?? 0 })],
  ['job', 'jobs', (_, target) => saveJob(target.classId)],
  ['duty', 'daily_duties', (_, target) => setDuty(target.classId, payrollDay, [target.studentId])],
  ['group', 'groups', (_, target) => saveGroup(target.classId)],
  ['announcement', 'announcements', (_, target) => saveAnnouncement(target.classId)],
  ['seating', 'seating', (_, target) => saveSeating(target.classId, {}, { rev: target.defaultsRev ?? 0 })],
  ['comment', 'comments', (_, target) => saveComment(target)],
]
