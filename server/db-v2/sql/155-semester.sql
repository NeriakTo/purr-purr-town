CREATE FUNCTION ppt.semester_at(p_day date)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = pg_catalog, ppt, pg_temp
AS $$
  SELECT (year - 1911 - CASE WHEN month < 8 THEN 1 ELSE 0 END)::text
    || CASE WHEN month BETWEEN 2 AND 7 THEN '-2' ELSE '-1' END
  FROM (SELECT extract(year FROM p_day)::integer AS year, extract(month FROM p_day)::integer AS month) AS parts;
$$;
