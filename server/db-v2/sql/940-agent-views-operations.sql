CREATE VIEW ppt_agent.confirmations WITH (security_barrier = true) AS
SELECT c.class_id, c.confirmation_id, c.kind, c.status::text AS status,
       c.created_at, c.processed_at, c.task_id, c.student_id, s.seat_number,
       c.proposed_status::text AS proposed_status, c.batch_id, c.held_reason
FROM ppt.confirmations c
LEFT JOIN ppt.students s ON s.class_id = c.class_id AND s.student_id = c.student_id
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = c.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.held_batches WITH (security_barrier = true) AS
SELECT c.class_id, c.confirmation_id, c.batch_id, c.status::text AS status,
       c.held_reason, c.created_at, c.processed_at, ac.note, ac.held_inputs,
       (
         SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'op_id', o.op_id, 'status', o.status, 'code', o.code::text, 'receipt', o.receipt
         ) ORDER BY member.position), '[]'::jsonb)
         FROM pg_catalog.jsonb_array_elements(ac.entries)
           WITH ORDINALITY AS member(entry, position)
         JOIN ppt.operations o ON o.class_id = ac.class_id AND o.op_id = member.entry->>'op_id'
         WHERE member.entry->'is_new' = 'true'::jsonb
       ) AS items
FROM ppt.confirmations c
JOIN ppt.agent_calls ac ON ac.class_id = c.class_id AND ac.call_id = c.batch_id
WHERE c.kind = 'agent_held'
  AND EXISTS (
    SELECT 1 FROM ppt.class_authorizations a
    WHERE a.class_id = c.class_id AND a.actor_kind = 'agent'
  );

CREATE VIEW ppt_agent.operations WITH (security_barrier = true) AS
SELECT o.class_id, o.op_id, o.actor_kind, o.type,
       CASE WHEN o.actor_kind = 'agent' THEN o.status END AS status,
       CASE WHEN o.actor_kind = 'agent' THEN o.code::text END AS code,
       o.class_seq,
       CASE WHEN o.actor_kind = 'agent' THEN o.recorded_at END AS recorded_at,
       o.committed_at,
       CASE WHEN o.actor_kind = 'agent' THEN o.batch_id END AS batch_id,
       s.seat_number AS target_seat_number,
       CASE WHEN o.actor_kind = 'agent' THEN o.payload END AS payload,
       CASE WHEN o.actor_kind = 'agent' THEN o.expect END AS expect,
       CASE WHEN o.actor_kind = 'agent' THEN o.receipt END AS receipt
FROM ppt.operations o
LEFT JOIN ppt.students s ON s.class_id = o.class_id AND s.student_id = o.payload->>'student_id'
WHERE (o.actor_kind = 'agent' OR o.status = 'committed')
  AND EXISTS (
    SELECT 1 FROM ppt.class_authorizations a
    WHERE a.class_id = o.class_id AND a.actor_kind = 'agent'
  );

CREATE VIEW ppt_agent.agent_calls WITH (security_barrier = true) AS
SELECT ac.class_id, ac.call_id, ac.created_at, ac.note,
       (
         SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'op_id', member.entry->>'op_id', 'is_new', member.entry->'is_new'
         ) ORDER BY member.position), '[]'::jsonb)
         FROM pg_catalog.jsonb_array_elements(ac.entries)
           WITH ORDINALITY AS member(entry, position)
       ) AS entries,
       ac.held_inputs
FROM ppt.agent_calls ac
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = ac.class_id AND a.actor_kind = 'agent'
);
