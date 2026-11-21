export async function queryAgentBatches(client, classId, readTime) {
  const { rows } = await client.query(`
    WITH batches AS (
      SELECT call.*, EXISTS (
        SELECT 1 FROM ppt.confirmations AS held
        WHERE held.class_id = call.class_id AND held.batch_id = call.call_id
          AND held.kind = 'agent_held' AND held.status = 'pending'
      ) AS pending_held
      FROM ppt.agent_calls AS call
      WHERE call.class_id = $1
    ), visible_batches AS (
      SELECT * FROM batches
      WHERE pending_held OR created_at BETWEEN $2::timestamptz - interval '7 days' AND $2::timestamptz
    ), members AS (
      SELECT call.call_id, call.class_id,
        CASE WHEN jsonb_typeof(op.payload->'student_id') = 'string' THEN op.type
             WHEN op.type = 'op.undo' THEN original.type ELSE op.type END AS type,
        CASE WHEN jsonb_typeof(op.payload->'student_id') = 'string' THEN op.payload
             WHEN op.type = 'op.undo' THEN original.payload ELSE op.payload END AS payload
      FROM visible_batches AS call
      CROSS JOIN LATERAL jsonb_array_elements(call.entries) AS saved(entry)
      JOIN ppt.operations AS op ON op.class_id = call.class_id AND op.op_id = entry->>'op_id'
        AND op.status = 'committed'
      LEFT JOIN ppt.operations AS original ON original.class_id = op.class_id AND op.type = 'op.undo'
        AND original.op_id = op.payload->>'target_op_id' AND original.actor_kind = 'agent'
        AND original.actor_id = 'agent' AND original.type <> 'op.undo'
      WHERE entry->'is_new' = 'true'::jsonb
    ), counts AS (
      SELECT member.call_id, count(*)::int AS op_count,
             array_agg(DISTINCT student.seat_number ORDER BY student.seat_number)
               FILTER (WHERE student.seat_number IS NOT NULL) AS seats
      FROM members AS member
      LEFT JOIN ppt.corrections AS correction
        ON correction.class_id = member.class_id AND member.type = 'correction.mark_returned'
        AND correction.correction_id = member.payload->>'correction_id'
      LEFT JOIN ppt.students AS student ON student.class_id = member.class_id AND student.student_id = CASE
        WHEN jsonb_typeof(member.payload->'student_id') = 'string' THEN member.payload->>'student_id'
        ELSE correction.student_id END
      GROUP BY member.call_id
    )
    SELECT call.call_id AS batch_id, to_jsonb(call.created_at) AS created_at, call.note,
           coalesce(counts.op_count, 0) AS op_count, coalesce(counts.seats, '{}') AS seats,
           call.pending_held, CASE WHEN call.pending_held THEN call.held_inputs END AS held_ops,
           EXISTS (
             SELECT 1 FROM ppt.operations AS undo
             WHERE undo.class_id = call.class_id AND undo.type = 'batch.undo'
               AND undo.status = 'committed' AND undo.payload->>'batch_id' = call.call_id
           ) AS undone
    FROM visible_batches AS call
    LEFT JOIN counts USING (call_id)
    ORDER BY call.created_at DESC, call.call_id COLLATE "C"
  `, [classId, readTime])
  return rows
}
