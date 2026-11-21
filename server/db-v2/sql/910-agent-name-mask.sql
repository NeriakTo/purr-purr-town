CREATE FUNCTION ppt_agent.mask_student_names(p_text text, p_roster jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, ppt, pg_temp
AS $$
DECLARE
  spaces constant text := U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000';
  gap constant text := '[' || spaces || ']*';
  failure constant text := '（遮罩失敗）';
  student jsonb;
  input_seat numeric;
  pattern text;
  replacements jsonb;
  masked text;
  missing_replacement boolean;
BEGIN
  IF p_text IS NULL THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_roster) IS DISTINCT FROM 'array' THEN
    RETURN failure;
  END IF;

  FOR student IN SELECT value FROM jsonb_array_elements(p_roster)
  LOOP
    IF jsonb_typeof(student) IS DISTINCT FROM 'object'
       OR jsonb_typeof(student->'name') IS DISTINCT FROM 'string'
       OR coalesce(jsonb_typeof(student->'seat_number'), '') NOT IN ('number', 'null') THEN
      RETURN failure;
    END IF;
    input_seat := (student->>'seat_number')::numeric;
    IF input_seat <> trunc(input_seat) THEN
      RETURN failure;
    END IF;
  END LOOP;

  WITH normalized AS (
    SELECT lower(translate(value->>'name', spaces, '')) AS name,
           trunc((value->>'seat_number')::numeric) AS seat
    FROM jsonb_array_elements(p_roster)
  ), spellings AS (
    SELECT form.spelling, n.seat
    FROM normalized n
    CROSS JOIN LATERAL (
      SELECT n.name AS spelling WHERE n.name <> ''
      UNION
      SELECT substr(n.name, 2) WHERE char_length(n.name) >= 3
      UNION
      SELECT right(n.name, 2) WHERE char_length(n.name) >= 4
    ) form
  ), labels AS (
    SELECT spelling, CASE WHEN count(*) >= 4 THEN '某位同學'
      ELSE string_agg(coalesce(seat::text || '號', '座號未定'), '或' ORDER BY seat NULLS LAST)
      END AS label
    FROM spellings
    GROUP BY spelling
  ), patterns AS (
    SELECT l.spelling, l.label,
           string_agg(
             CASE WHEN strpos($meta$\.^$|?*+()[]{}$meta$, character) > 0
                  THEN chr(92) || character ELSE character END, gap ORDER BY position
           ) AS expression
    FROM labels l
    CROSS JOIN LATERAL regexp_split_to_table(l.spelling, '') WITH ORDINALITY AS chars(character, position)
    GROUP BY l.spelling, l.label
  )
  SELECT string_agg(expression, '|' ORDER BY char_length(spelling) DESC, spelling),
         jsonb_object_agg(spelling, label)
  INTO pattern, replacements
  FROM patterns;

  IF pattern IS NULL THEN
    RETURN p_text;
  END IF;

  -- The second capture marks names. The single-character fallback preserves all other text.
  SELECT string_agg(rendered, '' ORDER BY position), bool_or(rendered IS NULL)
  INTO masked, missing_replacement
  FROM regexp_matches(p_text, '((' || pattern || ')|.)', 'gis')
       WITH ORDINALITY AS matches(parts, position)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN parts[2] IS NULL THEN parts[1]
                ELSE replacements->>lower(translate(parts[2], spaces, '')) END AS rendered
  ) piece;

  IF missing_replacement THEN
    RETURN failure;
  END IF;
  RETURN coalesce(masked, '');
EXCEPTION
  WHEN OTHERS OR query_canceled OR assert_failure THEN
    RETURN failure;
END;
$$;
