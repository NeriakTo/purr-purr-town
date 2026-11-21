// SQL 片段只由各實體查詢在程式內定義。請求的班級編號一律綁參數。
export async function queryVersionRows(client, classId, entity, sinceSeq, { from, key, value }) {
  const params = [classId, entity]
  let newer = ''
  if (sinceSeq !== undefined) {
    params.push(sinceSeq)
    const pending = entity === 'confirmation' ? "OR e.status = 'pending'" : ''
    newer = `AND (EXISTS (
      SELECT 1 FROM ppt.operations AS op
      WHERE op.class_id = $1 AND op.op_id = e.last_op_id AND op.class_seq > $3
    ) ${pending})`
  }
  const { rows } = await client.query(`
    SELECT $2::text AS entity, jsonb_build_object(${key}) AS key, e.rev, ${value} AS value
    FROM ${from}
    WHERE e.class_id = $1 ${newer}
  `, params)
  return rows
}
