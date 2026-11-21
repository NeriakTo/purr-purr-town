import { createHash } from 'node:crypto'

const operationNamespace = Buffer.from('7d0f4c539a1e4b7a8f352c6e1b90a4d8', 'hex')

function operationUuidV5(name) {
  const bytes = createHash('sha1').update(operationNamespace).update(name, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

export function correctionOverdueId(classId, date) {
  // 正式排程紀錄依賴此名稱沿用同一個操作編號。
  return operationUuidV5(`schedule.correction_overdue:${classId}:${date}`)
}

export function commentApplyId(requestOpId) {
  return operationUuidV5(`comment.apply_generated:${requestOpId}`)
}
