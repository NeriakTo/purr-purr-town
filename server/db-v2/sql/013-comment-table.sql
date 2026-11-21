CREATE TABLE ppt.comments (
  class_id text NOT NULL,
  student_id text NOT NULL,
  semester text NOT NULL,
  observation text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  motto text NOT NULL DEFAULT '',
  locked_comment jsonb NOT NULL DEFAULT 'false' CHECK (jsonb_typeof(locked_comment) = 'boolean'),
  locked_motto jsonb NOT NULL DEFAULT 'false' CHECK (jsonb_typeof(locked_motto) = 'boolean'),
  generation_status text NOT NULL DEFAULT 'idle' CHECK (generation_status IN ('idle', 'generating', 'failed')),
  generation_error text,
  analysis text,
  model text,
  suggestion jsonb,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, student_id, semester),
  FOREIGN KEY (class_id, student_id) REFERENCES ppt.students (class_id, student_id)
);
