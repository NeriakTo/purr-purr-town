CREATE TABLE ppt.groups (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  group_key text NOT NULL,
  name text NOT NULL,
  leader_student_id text,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, group_key),
  FOREIGN KEY (class_id, leader_student_id) REFERENCES ppt.students (class_id, student_id)
);
