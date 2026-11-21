CREATE FUNCTION ppt.uuid_sha1(p_input bytea)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  mask CONSTANT bigint := 4294967295;
  input_length integer := octet_length(p_input);
  padded bytea;
  words bigint[];
  hash bigint[] := ARRAY[1732584193, 4023233417, 2562383102, 271733878, 3285377520]::bigint[];
  block_offset integer;
  offset_in_block integer;
  i integer;
  word bigint;
  a bigint;
  b bigint;
  c bigint;
  d bigint;
  e bigint;
  round_value bigint;
  round_constant bigint;
BEGIN
  -- Append one bit, zero-fill to 56 bytes modulo 64, then append the bit length.
  padded := p_input || decode('80' || repeat('00', (119 - input_length % 64) % 64), 'hex')
    || int8send(input_length::bigint * 8);

  FOR block_offset IN 0..(octet_length(padded) / 64 - 1) LOOP
    words := array_fill(0::bigint, ARRAY[80], ARRAY[0]);
    FOR i IN 0..15 LOOP
      offset_in_block := block_offset * 64 + i * 4;
      words[i] := (get_byte(padded, offset_in_block)::bigint << 24)
        | (get_byte(padded, offset_in_block + 1)::bigint << 16)
        | (get_byte(padded, offset_in_block + 2)::bigint << 8)
        | get_byte(padded, offset_in_block + 3)::bigint;
    END LOOP;
    FOR i IN 16..79 LOOP
      word := words[i - 3] # words[i - 8] # words[i - 14] # words[i - 16];
      words[i] := ((word << 1) | (word >> 31)) & mask;
    END LOOP;

    a := hash[1];
    b := hash[2];
    c := hash[3];
    d := hash[4];
    e := hash[5];
    FOR i IN 0..79 LOOP
      CASE
        WHEN i < 20 THEN
          round_value := (b & c) | ((~b) & d);
          round_constant := 1518500249;
        WHEN i < 40 THEN
          round_value := b # c # d;
          round_constant := 1859775393;
        WHEN i < 60 THEN
          round_value := (b & c) | (b & d) | (c & d);
          round_constant := 2400959708;
        ELSE
          round_value := b # c # d;
          round_constant := 3395469782;
      END CASE;
      word := (((a << 5) | (a >> 27)) + round_value + e + round_constant + words[i]) & mask;
      e := d;
      d := c;
      c := ((b << 30) | (b >> 2)) & mask;
      b := a;
      a := word;
    END LOOP;

    hash[1] := (hash[1] + a) & mask;
    hash[2] := (hash[2] + b) & mask;
    hash[3] := (hash[3] + c) & mask;
    hash[4] := (hash[4] + d) & mask;
    hash[5] := (hash[5] + e) & mask;
  END LOOP;

  RETURN decode(lpad(to_hex(hash[1]), 8, '0') || lpad(to_hex(hash[2]), 8, '0')
    || lpad(to_hex(hash[3]), 8, '0') || lpad(to_hex(hash[4]), 8, '0')
    || lpad(to_hex(hash[5]), 8, '0'), 'hex');
END;
$$;

CREATE FUNCTION ppt.uuid_v5(p_namespace text, p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  bytes bytea;
  hex text;
BEGIN
  bytes := substring(uuid_sha1(uuid_send(p_namespace::uuid) || convert_to(p_name, 'UTF8')) FROM 1 FOR 16);
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 80);
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
  hex := encode(bytes, 'hex');
  RETURN substr(hex, 1, 8) || '-' || substr(hex, 9, 4) || '-' || substr(hex, 13, 4)
    || '-' || substr(hex, 17, 4) || '-' || substr(hex, 21, 12);
END;
$$;

CREATE FUNCTION ppt.operation_uuid_namespace()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT '7d0f4c53-9a1e-4b7a-8f35-2c6e1b90a4d8'::text;
$$;

CREATE FUNCTION ppt.batch_undo_op_id(p_batch_undo_id text, p_target_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT uuid_v5(operation_uuid_namespace(), 'batch.undo:' || p_batch_undo_id || ':' || p_target_id);
$$;
