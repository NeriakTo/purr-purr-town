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
