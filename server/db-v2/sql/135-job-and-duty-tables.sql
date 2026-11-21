CREATE TABLE ppt.jobs (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  job_id text NOT NULL,
  title text NOT NULL,
  salary numeric NOT NULL,
  icon text,
  cycle text NOT NULL CHECK (cycle IN ('daily', 'weekly', 'monthly', 'semester', 'once')),
  category text,
  disabled boolean NOT NULL DEFAULT false,
  assignee_ids jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(assignee_ids) = 'array'),
  origin text NOT NULL DEFAULT 'op' CHECK (origin IN ('op', 'migration')),
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, job_id)
);

CREATE TABLE ppt.daily_duties (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  duty_date date NOT NULL,
  student_ids jsonb NOT NULL CHECK (jsonb_typeof(student_ids) = 'array'),
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, duty_date)
);
