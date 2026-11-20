CREATE TABLE ppt.corrections (
  class_id text NOT NULL,
  correction_id text NOT NULL,
  task_id text NOT NULL,
  student_id text NOT NULL,
  round integer NOT NULL CHECK (round >= 1),
  status text NOT NULL CHECK (status IN ('required', 'returned', 'confirmed', 'redo', 'cancelled')),
  due_on date,
  note text,
  overdue_on date,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  basis_rev integer NOT NULL DEFAULT 1 CHECK (basis_rev BETWEEN 0 AND rev),
  last_op_id text,
  PRIMARY KEY (class_id, correction_id),
  FOREIGN KEY (class_id, task_id) REFERENCES ppt.tasks (class_id, task_id),
  FOREIGN KEY (class_id, student_id) REFERENCES ppt.students (class_id, student_id),
  CONSTRAINT corrections_unique_round UNIQUE (class_id, task_id, student_id, round),
  CHECK (basis_rev <> 0 OR status = 'cancelled')
);

CREATE UNIQUE INDEX corrections_one_open_round ON ppt.corrections (class_id, task_id, student_id)
WHERE status IN ('required', 'returned');
