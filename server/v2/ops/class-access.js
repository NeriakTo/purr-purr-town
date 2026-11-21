import { readQuery } from '../db.js'
import { RequestError } from '../errors.js'

export async function precheckClassAccess(pool, classId, actor, firstOp) {
  const mayCreate = firstOp?.type === 'class.create' && firstOp.payload?.class_id === classId
  const { rows: [{ allowed }] } = await readQuery(pool, `
    SELECT CASE
      WHEN ppt.can_access_class($1, $2::jsonb) THEN true
      WHEN $3::boolean THEN NOT EXISTS (SELECT 1 FROM ppt.classes WHERE class_id = $1)
      ELSE false
    END AS allowed
  `, [classId, actor, mayCreate])
  if (!allowed) throw new RequestError('CLASS_FORBIDDEN')
}
