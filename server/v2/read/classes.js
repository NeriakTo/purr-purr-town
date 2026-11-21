export const classValueSql = `jsonb_build_object(
  'name', e.name,
  'alias', e.alias,
  'teacher_name', e.teacher,
  'school_year', e.school_year,
  'status', e.status,
  'cutover_date', e.cutover_date
)`

export async function queryOwnedClasses(client, teacherId) {
  const { rows } = await client.query(`
    SELECT e.class_id, e.class_seq, e.rev, ${classValueSql} AS value,
           to_jsonb(export.last_export_at) AS last_export_at
    FROM ppt.class_ownership AS owner
    JOIN ppt.classes AS e ON e.class_id = owner.class_id
    LEFT JOIN ppt_web_state.class_exports AS export ON export.class_id = e.class_id
    WHERE owner.teacher_id = $1
    ORDER BY e.class_id COLLATE "C"
  `, [teacherId])
  return rows
}

export function buildClassesResponse(clock, classes) {
  return {
    server_time: clock().toISOString(),
    classes: classes.map(row => ({ ...row, class_seq: Number(row.class_seq) })),
  }
}
