CREATE TYPE ppt.confirmation_status AS ENUM ('pending', 'confirmed', 'rejected', 'superseded');

CREATE TABLE ppt.confirmations (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  confirmation_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('leader_proposal', 'agent_held')),
  status ppt.confirmation_status NOT NULL DEFAULT 'pending',
  task_id text,
  student_id text,
  proposed_status ppt.submission_status,
  created_op_id text NOT NULL,
  created_at timestamptz NOT NULL,
  processed_op_id text,
  processed_at timestamptz,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text NOT NULL,
  PRIMARY KEY (class_id, confirmation_id),
  FOREIGN KEY (class_id, task_id, student_id) REFERENCES ppt.submissions (class_id, task_id, student_id),
  FOREIGN KEY (class_id, created_op_id) REFERENCES ppt.operations (class_id, op_id),
  FOREIGN KEY (class_id, processed_op_id) REFERENCES ppt.operations (class_id, op_id),
  CHECK (kind <> 'leader_proposal' OR (
    task_id IS NOT NULL AND student_id IS NOT NULL AND proposed_status IS NOT NULL
    AND proposed_status IN ('on_time', 'late', 'missing') AND confirmation_id = created_op_id
  )),
  CHECK (
    (status = 'pending' AND processed_op_id IS NULL AND processed_at IS NULL)
    OR (status <> 'pending' AND processed_op_id IS NOT NULL AND processed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX confirmations_pending_leader_proposal ON ppt.confirmations (class_id, task_id, student_id)
WHERE kind = 'leader_proposal' AND status = 'pending';
