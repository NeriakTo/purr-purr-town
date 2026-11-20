import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { submit } from './operations.js'

export function operation(classId, type, payload, expectVersion) {
  return {
    op_id: randomUUID(), class_id: classId, type, payload,
    ...(expectVersion === undefined ? {} : { expect: expectVersion }),
  }
}

export function saveRule(classId, fields = {}, rev = 0) {
  return operation(classId, 'rule.save', {
    rule_id: randomUUID(), kind: 'manual', name: '試用規則', amount: 5, ...fields,
  }, { rev })
}

export function retireRule(classId, ruleId, rev) {
  return operation(classId, 'rule.retire', { rule_id: ruleId }, { rev })
}

export async function commitOperation(client, op) {
  const receipt = await submit(client, op)
  expect(receipt).toMatchObject({ status: 'committed', code: 'OK' })
  return receipt
}

export function createTask(classId, fields = {}) {
  return operation(classId, 'task.create', {
    task_id: randomUUID(), title: '測試作業', task_type: '作業',
    published_on: '2026-11-21', due_on: '2026-11-22', ...fields,
  })
}

export function updateTask(classId, taskId, fields, expectVersion = { rev: 1 }) {
  return operation(classId, 'task.update', { task_id: taskId, ...fields }, expectVersion)
}
