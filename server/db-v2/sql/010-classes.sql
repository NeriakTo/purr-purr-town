CREATE TABLE ppt.classes (
  class_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  class_seq bigint NOT NULL DEFAULT 0 CHECK (class_seq >= 0),
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text
);

CREATE TABLE ppt.class_ownership (
  class_id text PRIMARY KEY REFERENCES ppt.classes (class_id),
  teacher_id text NOT NULL
);

CREATE TABLE ppt.class_authorizations (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('agent', 'scheduler')),
  PRIMARY KEY (class_id, actor_kind)
);

CREATE TABLE ppt.students (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  student_id text NOT NULL,
  seat_number integer,
  name text NOT NULL,
  group_key text,
  exempt_rules jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(exempt_rules) = 'array'),
  enrollment_status text NOT NULL DEFAULT 'enrolled'
    CHECK (enrollment_status IN ('enrolled', 'home_study', 'transferred', 'archived')),
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, student_id)
);
