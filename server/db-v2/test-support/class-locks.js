import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { commitClass, createClass } from './class-create.js'
import { updateStudentProfile } from './class-student-group.js'
import { saveComment } from './comments.js'
import { useItem } from './inventory.js'
import { adjustment, cancel } from './operations.js'
import { retireJob, saveJob } from './payroll.js'
import { saveProduct } from './products.js'
import { commitOperation, createTask, operation, saveRule } from './schoolwork.js'
import { setSetting } from './settings.js'
import { purchase } from './shop.js'
import { setStatus } from './submissions.js'

function revision(receipt, entity, key, id) {
  return receipt.changes.find(change => change.entity === entity && change.key[key] === id).rev
}

function mixedClassState(classId, studentIds, ruleId, worker) {
  const settingKey = worker === 0 ? 'taskTypes' : 'shopMeta'
  let settingRev = 1
  const profileRevs = new Map(studentIds.map(id => [id, 1]))
  const commentRevs = new Map(studentIds.map(id => [id, 0]))
  let credit
  let taskId
  let submissionRev
  let productId
  let itemId
  const steps = [
    (send, target) => send(adjustment(target, 40)),
    async (send, target) => {
      credit = adjustment(target, 1)
      await send(credit)
    },
    send => send(operation(classId, 'op.undo', { target_op_id: credit.op_id })),
    (send, { studentId }) => send(operation(classId, 'points.apply_rule', {
      student_id: studentId, rule_id: ruleId, rule_version: 1,
    })),
    async (send, { studentId }) => {
      const task = createTask(classId, { assignee_ids: studentIds })
      taskId = task.payload.task_id
      submissionRev = revision(await send(task), 'submission', 'student_id', studentId)
    },
    (send, target) => send(setStatus({ ...target, taskId }, 'missing', { rev: submissionRev })),
    async send => {
      const product = saveProduct(classId)
      productId = product.payload.product_id
      await send(product)
    },
    async (send, target) => {
      const buy = purchase({ ...target, productId })
      itemId = buy.payload.item_id
      await send(buy)
    },
    send => send(useItem(classId, itemId)),
    async (send, _target, round) => {
      const value = worker === 0 ? ['測試作業 ' + round] : { name: '測試商店 ' + round }
      const receipt = await send(setSetting(classId, settingKey, value, { rev: settingRev }))
      settingRev = revision(receipt, 'setting', 'key', settingKey)
    },
    async (send, target, round) => {
      const { studentId } = target
      const op = updateStudentProfile(target, { avatar: '測試頭像 ' + round }, { rev: profileRevs.get(studentId) })
      profileRevs.set(studentId, revision(await send(op), 'student', 'student_id', studentId))
    },
    async (send, target, round) => {
      const { studentId } = target
      const op = saveComment(target, { comment: '測試評語 ' + round }, { rev: commentRevs.get(studentId) })
      commentRevs.set(studentId, revision(await send(op), 'comment', 'student_id', studentId))
    },
  ]
  return steps
}

export async function sendMixedClassOperations(client, classId, studentIds, ruleId, worker) {
  const classSequences = []
  let cancelled = 0
  async function send(op) {
    const receipt = await commitOperation(client, op)
    classSequences.push(receipt.class_seq)
    return receipt
  }
  const steps = mixedClassState(classId, studentIds, ruleId, worker)
  const roundSize = steps.length + 1
  for (let index = 0; index < 200; index += 1) {
    const step = index % roundSize
    const round = Math.floor(index / roundSize)
    const target = { classId, studentId: studentIds[round % studentIds.length] }
    if (step === steps.length) {
      expect(await cancel(client, classId, randomUUID())).toMatchObject({ status: 'cancelled', code: 'OP_CANCELLED' })
      cancelled += 1
    } else {
      await steps[step](send, target, round)
    }
  }
  expect(cancelled).toBe(15)
  expect(classSequences).toHaveLength(185)
  return classSequences
}

export async function prepareInheritanceRace(client) {
  const source = await commitClass(client, createClass(0))
  const job = saveJob(source.classId, { cycle: 'daily' })
  await commitOperation(client, job)
  const jobId = job.payload.job_id
  await commitOperation(client, setSetting(source.classId, 'dutyJobId', jobId))
  const event = source.receipt.changes.find(change => change.value.event === 'submission.late')
  return { classId: source.classId, jobId, ruleId: event.key.rule_id }
}

export async function updateInheritanceSource(client, { classId, jobId, ruleId }) {
  let dutyId = jobId
  for (let i = 0; i < 30; i += 1) {
    const next = saveJob(classId, { cycle: 'daily' })
    await commitOperation(client, next)
    const retired = await commitOperation(client, retireJob(classId, dutyId))
    await commitOperation(client, saveRule(classId, {
      rule_id: ruleId, kind: 'event', event: 'submission.late', amount: -11 - i,
    }, i + 1))
    await commitOperation(client, saveProduct(classId))
    dutyId = next.payload.job_id
    await commitOperation(client, setSetting(classId, 'dutyJobId', dutyId, {
      rev: revision(retired, 'setting', 'key', 'dutyJobId'),
    }))
  }
}

export async function createInheritanceRaceClasses(client, sourceId) {
  const classes = []
  for (let i = 0; i < 30; i += 1) {
    const { classId } = await commitClass(client, createClass(0, randomUUID(), { inherit_from_class_id: sourceId }))
    classes.push(classId)
  }
  return classes
}
