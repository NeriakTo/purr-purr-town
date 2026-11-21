import { classValueSql } from './classes.js'
import { queryVersionRows } from './version-query.js'

export function queryClassRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'class', sinceSeq, {
    from: 'ppt.classes AS e',
    key: "'class_id', e.class_id",
    value: classValueSql,
  })
}

export function queryStudentRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'student', sinceSeq, {
    from: 'ppt.students AS e',
    key: "'student_id', e.student_id",
    value: `jsonb_build_object(
      'name', e.name, 'seat_number', e.seat_number, 'avatar', e.avatar,
      'group_key', e.group_key, 'enrollment_status', e.enrollment_status, 'exempt_rules', e.exempt_rules
    )`,
  })
}

export function queryGroupRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'group', sinceSeq, {
    from: 'ppt.groups AS e',
    key: "'group_key', e.group_key",
    value: "jsonb_build_object('name', e.name, 'leader_student_id', e.leader_student_id)",
  })
}

export function queryAnnouncementRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'announcement', sinceSeq, {
    from: 'ppt.announcements AS e',
    key: "'announcement_id', e.announcement_id",
    value: `jsonb_build_object(
      'text', e.text, 'color', e.color, 'rotation', e.rotation, 'removed', e.removed
    )`,
  })
}

export function querySeatingRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'seating', sinceSeq, {
    from: 'ppt.seating AS e',
    key: "'class_id', e.class_id",
    value: `jsonb_build_object(
      'rows', e.rows, 'cols', e.cols, 'view', e.view,
      'seats', e.seats, 'objects', e.objects, 'custom_objects', e.custom_objects
    )`,
  })
}

export function queryCommentRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'comment', sinceSeq, {
    from: 'ppt.comments AS e',
    key: "'student_id', e.student_id, 'semester', e.semester",
    value: `jsonb_build_object(
      'observation', e.observation, 'comment', e.comment, 'motto', e.motto,
      'comment_locked', e.locked_comment, 'motto_locked', e.locked_motto,
      'generation_status', e.generation_status, 'generation_error', e.generation_error,
      'analysis', e.analysis, 'model', e.model, 'suggestion', e.suggestion
    )`,
  })
}

export function querySettingRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'setting', sinceSeq, {
    from: 'ppt.settings_entries AS e',
    key: "'key', e.key",
    value: "jsonb_build_object('value', e.value)",
  })
}
