// SQL 片段只由各實體查詢在程式內定義。請求的班級編號一律綁參數。
export async function queryVersionRows(client, classId, entity, { from, key, value }) {
  const { rows } = await client.query(`
    SELECT $2::text AS entity, jsonb_build_object(${key}) AS key, e.rev, ${value} AS value
    FROM ${from}
    WHERE e.class_id = $1
  `, [classId, entity])
  return rows
}
