import { randomUUID } from 'node:crypto'

export async function addTask(client, classId, { voided = false } = {}) {
  const taskId = randomUUID()
  await client.query(`
    INSERT INTO ppt.tasks (class_id, task_id, title, task_type, published_on, due_on, semester, voided)
    VALUES ($1,$2,'試用作業','作業','2026-11-21','2026-11-22','115-1',$3)
  `, [classId, taskId, voided])
  return taskId
}

export async function addSubmission(client, { classId, taskId, studentId }, { rev = 1, active = true } = {}) {
  await client.query(`
    INSERT INTO ppt.submissions (class_id, task_id, student_id, rev, basis_rev, assignment_active)
    VALUES ($1,$2,$3,$4,$5,$6)
  `, [classId, taskId, studentId, rev, active ? rev : 0, active])
}

export async function addEventRule(client, classId, event = 'submission.missing', amount = -5) {
  const ruleId = randomUUID()
  await client.query(`
    WITH rule AS (
      INSERT INTO ppt.rules (class_id, rule_id, kind, event)
      VALUES ($1,$2,'event',$3) RETURNING class_id, rule_id
    )
    INSERT INTO ppt.rule_versions (class_id, rule_id, rev, name, amount, effective_at)
    SELECT class_id, rule_id, 1, '作業事件', $4, clock_timestamp() FROM rule
  `, [classId, ruleId, event, amount])
  return ruleId
}

export function setStatus({ classId, taskId, studentId }, status, expect = { rev: 1 }) {
  return {
    op_id: randomUUID(),
    class_id: classId,
    type: 'submission.set_status',
    payload: { task_id: taskId, student_id: studentId, status },
    expect,
  }
}

export async function submissionRow(client, { classId, taskId, studentId }) {
  const { rows: [row] } = await client.query(`
    SELECT status, rev, basis_rev, assignment_active, last_op_id FROM ppt.submissions
    WHERE class_id = $1 AND task_id = $2 AND student_id = $3
  `, [classId, taskId, studentId])
  return row
}
