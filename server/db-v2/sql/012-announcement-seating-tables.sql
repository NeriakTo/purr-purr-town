CREATE TABLE ppt.announcements (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  announcement_id text NOT NULL,
  text text NOT NULL,
  color text,
  rotation numeric,
  removed boolean NOT NULL DEFAULT false,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, announcement_id)
);

CREATE TABLE ppt.seating (
  class_id text PRIMARY KEY REFERENCES ppt.classes (class_id),
  rows integer NOT NULL,
  cols integer NOT NULL,
  view text NOT NULL,
  seats jsonb NOT NULL,
  objects jsonb NOT NULL,
  custom_objects jsonb NOT NULL,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text
);
