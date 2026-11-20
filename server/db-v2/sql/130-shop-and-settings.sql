CREATE TABLE ppt.products (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  product_id text NOT NULL,
  name text NOT NULL,
  icon text,
  price numeric NOT NULL CHECK (price >= 0 AND price < 'Infinity'::numeric),
  price_unit text NOT NULL CHECK (price_unit IN ('point', 'fish', 'cookie')),
  stock integer CHECK (stock >= 0),
  initial_stock integer CHECK (initial_stock >= 0),
  disabled boolean NOT NULL DEFAULT false,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, product_id)
);

CREATE TABLE ppt.inventory_items (
  class_id text NOT NULL,
  item_id text NOT NULL,
  student_id text NOT NULL,
  product_id text NOT NULL,
  product_name text NOT NULL,
  product_icon text,
  purchase_transaction_id text,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'used', 'returned')),
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, item_id),
  FOREIGN KEY (class_id, student_id) REFERENCES ppt.students (class_id, student_id),
  FOREIGN KEY (class_id, product_id) REFERENCES ppt.products (class_id, product_id)
);

CREATE TABLE ppt.settings_entries (
  class_id text NOT NULL REFERENCES ppt.classes (class_id),
  key text NOT NULL,
  value jsonb NOT NULL,
  rev integer NOT NULL DEFAULT 1 CHECK (rev >= 1),
  last_op_id text,
  PRIMARY KEY (class_id, key)
);
