const candidateSql = `
  SELECT jsonb_agg(
    jsonb_build_object(
      'transaction_id', tx.transaction_id, 'effective_amount', amount.effective_amount,
      'reason', tx.reason, 'effective_at', tx.effective_at,
      'default_listed', tx.reason IN ('作業遲交', '作業缺交'),
      'suggested', tx.transaction_id IS NOT DISTINCT FROM effect.suggested_transaction_id
    )
    ORDER BY (tx.transaction_id IS NOT DISTINCT FROM effect.suggested_transaction_id) DESC,
             tx.effective_at, tx.transaction_id COLLATE "C"
  ) AS items
  FROM ppt.transactions AS tx
  CROSS JOIN LATERAL (
    SELECT tx.amount + coalesce(sum(child.amount), 0) AS effective_amount
    FROM ppt.transactions AS child
    WHERE child.class_id = tx.class_id AND child.student_id = tx.student_id
      AND child.root_transaction_id = tx.transaction_id AND child.kind IN ('correction', 'reversal')
  ) AS amount
  WHERE tx.class_id = effect.class_id AND tx.student_id = effect.student_id
    AND tx.root_transaction_id IS NULL AND tx.kind = 'legacy_general' AND tx.origin = 'migration'
    AND amount.effective_amount < 0
    AND tx.effective_at IS NOT NULL AND (tx.effective_at AT TIME ZONE 'Asia/Taipei')::date >= task.published_on
    AND NOT EXISTS (
      SELECT 1 FROM ppt.effects AS linked
      WHERE linked.class_id = tx.class_id AND linked.root_transaction_id = tx.transaction_id
    )
    AND effect.status = 'legacy_unresolved'
`

const changedEffectsSql = `
  WITH changed_submissions AS (
    SELECT task_id, student_id
    FROM jsonb_to_recordset($2::jsonb) AS entry(task_id text, student_id text)
  ), affected_students AS (
    SELECT student_id FROM changed_submissions
    UNION SELECT unnest($3::text[])
    UNION
    SELECT changed.student_id
    FROM ppt.effects AS changed
    JOIN ppt.operations AS op ON op.class_id = changed.class_id
      AND op.op_id IN (changed.created_op_id, changed.reversed_op_id)
    WHERE changed.class_id = $1 AND op.class_seq > $4
  )
`

const incrementalFilter = `
  (EXISTS (
    SELECT 1 FROM changed_submissions AS submission
    WHERE submission.task_id = effect.subject_key AND submission.student_id = effect.student_id
  ) OR (
    effect.status = 'legacy_unresolved' AND effect.student_id IN (SELECT student_id FROM affected_students)
  ))
`

export async function queryLegacyEffects(client, classId, { sinceSeq, rows, transactions }) {
  const full = sinceSeq === undefined
  const params = full ? [classId] : [
    classId,
    JSON.stringify(rows.filter(row => row.entity === 'submission').map(row => row.key)),
    transactions.map(row => row.student_id),
    sinceSeq,
  ]
  const { rows: effects } = await client.query(`
    ${full ? '' : changedEffectsSql}
    SELECT effect.effect_id, effect.student_id, effect.subject_key AS task_id,
           effect.status, effect.suggested_transaction_id, coalesce(candidates.items, '[]'::jsonb) AS candidates
    FROM ppt.effects AS effect
    JOIN ppt.tasks AS task ON task.class_id = effect.class_id AND task.task_id = effect.subject_key
    CROSS JOIN LATERAL (${candidateSql}) AS candidates
    WHERE effect.class_id = $1 AND effect.origin = 'legacy' AND effect.subject_kind = 'task'
      AND ${full ? "effect.status = 'legacy_unresolved'" : incrementalFilter}
    ORDER BY effect.effect_id COLLATE "C"
  `, params)
  return effects
}
