CREATE VIEW ppt_agent.classes WITH (security_barrier = true) AS
SELECT c.class_id, c.status, c.class_seq,
       (
         SELECT o.committed_at FROM ppt.operations o
         WHERE o.class_id = c.class_id AND o.status = 'committed'
         ORDER BY o.class_seq DESC LIMIT 1
       ) AS last_committed_at
FROM ppt.classes c
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = c.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.students WITH (security_barrier = true) AS
SELECT st.class_id, st.student_id, st.seat_number,
       ppt_agent.mask_student_names(st.group_key, m.roster) AS group_key,
       st.enrollment_status
FROM ppt.students st
CROSS JOIN LATERAL (
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'seat_number', s.seat_number, 'name', s.name
  )), '[]'::jsonb) AS roster
  FROM ppt.students s
  WHERE s.class_id = st.class_id
) m
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = st.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.groups WITH (security_barrier = true) AS
SELECT g.class_id,
       ppt_agent.mask_student_names(g.group_key, m.roster) AS group_key,
       ppt_agent.mask_student_names(g.name, m.roster) AS name,
       g.leader_student_id
FROM ppt.groups g
CROSS JOIN LATERAL (
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'seat_number', s.seat_number, 'name', s.name
  )), '[]'::jsonb) AS roster
  FROM ppt.students s
  WHERE s.class_id = g.class_id
) m
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = g.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.accounts WITH (security_barrier = true) AS
SELECT ac.class_id, ac.student_id, ac.balance, ac.total_earned
FROM ppt.accounts ac
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = ac.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.transactions WITH (security_barrier = true) AS
SELECT t.class_id, t.transaction_id, t.student_id, t.kind, t.amount, t.earned_delta,
       t.occurred_at, t.effective_at, t.semester, t.rule_id, t.rule_rev,
       ppt_agent.mask_student_names(v.name, m.roster) AS rule_name,
       t.root_transaction_id, t.op_id
FROM ppt.transactions t
LEFT JOIN ppt.rule_versions v
  ON v.class_id = t.class_id AND v.rule_id = t.rule_id AND v.rev = t.rule_rev
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

CREATE VIEW ppt_agent.rules WITH (security_barrier = true) AS
SELECT r.class_id, r.rule_id, r.kind, r.event::text AS event, r.disabled, r.rev,
       ppt_agent.mask_student_names(v.name, m.roster) AS name, v.amount,
       ppt_agent.mask_student_names(v.icon, m.roster) AS icon,
       ppt_agent.mask_student_names(v.category, m.roster) AS category, v.effective_at
FROM ppt.rules r
JOIN ppt.rule_versions v ON v.class_id = r.class_id AND v.rule_id = r.rule_id AND v.rev = r.rev
CROSS JOIN LATERAL (
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'seat_number', s.seat_number, 'name', s.name
  )), '[]'::jsonb) AS roster
  FROM ppt.students s
  WHERE s.class_id = r.class_id
) m
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = r.class_id AND a.actor_kind = 'agent'
);

CREATE VIEW ppt_agent.rule_versions WITH (security_barrier = true) AS
SELECT v.class_id, v.rule_id, v.rev,
       ppt_agent.mask_student_names(v.name, m.roster) AS name, v.amount,
       ppt_agent.mask_student_names(v.icon, m.roster) AS icon,
       ppt_agent.mask_student_names(v.category, m.roster) AS category, v.effective_at
FROM ppt.rule_versions v
CROSS JOIN LATERAL (
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'seat_number', s.seat_number, 'name', s.name
  )), '[]'::jsonb) AS roster
  FROM ppt.students s
  WHERE s.class_id = v.class_id
) m
WHERE EXISTS (
  SELECT 1 FROM ppt.class_authorizations a
  WHERE a.class_id = v.class_id AND a.actor_kind = 'agent'
);
