export const classValueSql = `jsonb_build_object(
  'name', c.name,
  'alias', c.alias,
  'teacher_name', c.teacher,
  'school_year', c.school_year,
  'status', c.status,
  'cutover_date', c.cutover_date
)`

export async function queryOwnedClasses(client, teacherId) {
  const { rows } = await client.query(`
    SELECT c.class_id, c.class_seq, c.rev, ${classValueSql} AS value,
           to_jsonb(export.last_export_at) AS last_export_at
    FROM ppt.class_ownership AS owner
    JOIN ppt.classes AS c ON c.class_id = owner.class_id
    LEFT JOIN ppt_web_state.class_exports AS export ON export.class_id = c.class_id
    WHERE owner.teacher_id = $1
    ORDER BY c.class_id COLLATE "C"
  `, [teacherId])
  return rows
}

export function buildClassesResponse(clock, classes) {
  return {
    server_time: clock().toISOString(),
    classes: classes.map(row => ({ ...row, class_seq: Number(row.class_seq) })),
  }
}
