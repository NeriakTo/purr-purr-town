CREATE VIEW ppt_agent.tasks WITH (security_barrier = true) AS
SELECT t.class_id, t.task_id,
       ppt_agent.mask_student_names(t.title, m.roster) AS title,
       ppt_agent.mask_student_names(t.task_type, m.roster) AS task_type,
       ppt_agent.mask_student_names(t.page_text, m.roster) AS page_text,
       t.published_on, t.due_on, t.semester, t.voided
FROM ppt.tasks t
CROSS JOIN LATERAL (
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'seat_number', s.seat_number, 'name', s.name
  )), '[]'::jsonb) AS roster
  FROM ppt.students s
  WHERE s.class_id = t.class_id
) m
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = t.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.submissions WITH (security_barrier = true) AS
SELECT s.class_id, s.task_id, s.student_id, s.status::text AS status, s.rev, s.last_op_id,
       EXISTS (
         SELECT 1 FROM ppt.effects e
         WHERE e.class_id = s.class_id AND e.student_id = s.student_id
           AND e.subject_kind = 'task' AND e.subject_key = s.task_id AND e.status = 'legacy_unresolved'
       ) AS has_unresolved_legacy_effect
FROM ppt.submissions s
WHERE s.assignment_active
  AND EXISTS (
    SELECT 1 FROM ppt.class_authorizations a
    WHERE a.class_id = s.class_id AND a.actor_kind = 'agent'
  );

CREATE VIEW ppt_agent.corrections WITH (security_barrier = true) AS
SELECT c.class_id, c.correction_id, c.task_id, c.student_id, c.round,
       c.status, c.due_on, c.overdue_on,
       CASE WHEN EXISTS (
         SELECT 1 FROM ppt.operations o
         WHERE o.class_id = c.class_id AND o.type = 'correction.require' AND o.status = 'committed'
           AND o.actor_kind = 'agent' AND o.payload->>'correction_id' = c.correction_id
       ) THEN c.note ELSE ppt_agent.mask_student_names(c.note, m.roster) END AS note,
       c.rev
FROM ppt.corrections c
CROSS JOIN LATERAL (
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'seat_number', s.seat_number, 'name', s.name
  )), '[]'::jsonb) AS roster
  FROM ppt.students s
  WHERE s.class_id = c.class_id
) m
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = c.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.jobs WITH (security_barrier = true) AS
SELECT j.class_id, j.job_id,
       ppt_agent.mask_student_names(j.title, m.roster) AS title, j.salary,
       ppt_agent.mask_student_names(j.icon, m.roster) AS icon, j.cycle,
       ppt_agent.mask_student_names(j.category, m.roster) AS category, j.disabled
FROM ppt.jobs j
CROSS JOIN LATERAL (
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'seat_number', s.seat_number, 'name', s.name
  )), '[]'::jsonb) AS roster
  FROM ppt.students s
  WHERE s.class_id = j.class_id
) m
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = j.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.job_assignees WITH (security_barrier = true) AS
SELECT j.class_id, j.job_id, assignee.position, assignee.student_id
FROM ppt.jobs j
CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(j.assignee_ids)
  WITH ORDINALITY AS assignee(student_id, position)
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = j.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.daily_duties WITH (security_barrier = true) AS
SELECT d.class_id, d.duty_date, assignee.position, assignee.student_id
FROM ppt.daily_duties d
CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(d.student_ids)
  WITH ORDINALITY AS assignee(student_id, position)
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = d.class_id AND a.actor_kind = 'agent'
);
