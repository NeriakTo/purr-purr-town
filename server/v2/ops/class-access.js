import { readQuery } from '../db.js'
import { RequestError } from '../errors.js'

// 與 ppt.valid_v4_op_id 使用相同的格式，保留大小寫與字串邊界。
export function isV4ClassId(classId) {
  return typeof classId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(classId)
}

export async function precheckClassAccess(pool, classId, actor, firstOp) {
  const mayCreate = firstOp?.type === 'class.create'
    && isV4ClassId(classId)
    && firstOp.payload?.class_id === classId
  const { rows: [{ allowed }] } = await readQuery(pool, `
    SELECT CASE
      WHEN ppt.can_access_class($1, $2::jsonb) THEN true
      WHEN $3::boolean THEN NOT EXISTS (SELECT 1 FROM ppt.classes WHERE class_id = $1)
      ELSE false
    END AS allowed
  `, [classId, actor, mayCreate])
  if (!allowed) throw new RequestError('CLASS_FORBIDDEN')
}
