import { operation } from './schoolwork.js'

export function undo(classId, targetOpId) {
  return operation(classId, 'op.undo', { target_op_id: targetOpId })
}
