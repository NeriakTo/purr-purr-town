CREATE TYPE ppt.submission_status AS ENUM (
  'pending', 'on_time', 'late', 'missing', 'leave', 'exempt', 'makeup', 'unknown'
);

CREATE TABLE ppt.tasks (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  task_id text NOT NULL,
  title text NOT NULL,
  task_type text NOT NULL,
  page_text text,
  published_on date NOT NULL,
  due_on date NOT NULL,
  semester text NOT NULL,
  voided boolean NOT NULL DEFAULT false,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, task_id)
);

CREATE TABLE ppt.submissions (
  class_id text NOT NULL,
  task_id text NOT NULL,
  student_id text NOT NULL,
  status ppt.submission_status NOT NULL DEFAULT 'pending',
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  basis_rev integer NOT NULL DEFAULT 1 CHECK (basis_rev BETWEEN 0 AND rev),
  assignment_active boolean NOT NULL DEFAULT true,
  last_op_id text,
  legacy_status_at_import ppt.submission_status,
  PRIMARY KEY (class_id, task_id, student_id),
  FOREIGN KEY (class_id, task_id) REFERENCES ppt.tasks (class_id, task_id),
  FOREIGN KEY (class_id, student_id) REFERENCES ppt.students (class_id, student_id),
  CHECK (assignment_active OR (status = 'pending' AND basis_rev = 0))
);
