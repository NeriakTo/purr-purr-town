import { queryVersionRows } from './version-query.js'

export function querySubmissionRows(client, classId) {
  return queryVersionRows(client, classId, 'submission', {
    from: 'ppt.submissions AS e',
    key: "'task_id', e.task_id, 'student_id', e.student_id",
    value: "jsonb_build_object('status', e.status, 'assignment_active', e.assignment_active)",
  })
}

export function queryTaskRows(client, classId) {
  return queryVersionRows(client, classId, 'task', {
    from: 'ppt.tasks AS e',
    key: "'task_id', e.task_id",
    value: `jsonb_build_object(
      'title', e.title, 'task_type', e.task_type, 'page_text', e.page_text,
      'published_on', e.published_on, 'due_on', e.due_on, 'semester', e.semester, 'voided', e.voided
    )`,
  })
}

export function queryConfirmationRows(client, classId) {
  return queryVersionRows(client, classId, 'confirmation', {
    from: 'ppt.confirmations AS e',
    key: "'confirmation_id', e.confirmation_id",
    value: `jsonb_build_object(
      'status', e.status, 'processed_op_id', e.processed_op_id, 'processed_at', e.processed_at,
      'kind', e.kind, 'task_id', e.task_id, 'student_id', e.student_id,
      'proposed_status', e.proposed_status, 'created_op_id', e.created_op_id, 'created_at', e.created_at,
      'batch_id', e.batch_id, 'held_reason', e.held_reason
    )`,
  })
}

export function queryCorrectionRows(client, classId) {
  return queryVersionRows(client, classId, 'correction', {
    from: 'ppt.corrections AS e',
    key: "'correction_id', e.correction_id",
    value: `jsonb_build_object(
      'status', e.status, 'round', e.round, 'due_on', e.due_on, 'overdue_on', e.overdue_on,
      'task_id', e.task_id, 'student_id', e.student_id, 'note', e.note
    )`,
  })
}
