import { randomUUID } from 'node:crypto'

export { addClass as createTestClass } from '../../db-v2/test-support/operations.js'

export function createTestTeacher() {
  return { kind: 'teacher', id: randomUUID() }
}
