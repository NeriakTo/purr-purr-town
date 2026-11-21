export async function queryPayroll(client, classId, readTime) {
  const { rows } = await client.query(`
    WITH date_parts AS (
      SELECT pay_date, extract(year FROM pay_date)::int AS year,
             extract(month FROM pay_date)::int AS month
      FROM (SELECT ($2::timestamptz AT TIME ZONE 'Asia/Taipei')::date AS pay_date) AS today
    ), periods AS (
      SELECT pay_date, cycle, period, first_day
      FROM date_parts
      CROSS JOIN LATERAL (VALUES
        ('daily', to_char(pay_date, 'YYYY-MM-DD'), pay_date),
        ('weekly', to_char(pay_date, 'IYYY-"W"IW'), date_trunc('week', pay_date::timestamp)::date),
        ('monthly', to_char(pay_date, 'YYYY-MM'), date_trunc('month', pay_date::timestamp)::date),
        ('semester',
          (year - 1911 - CASE WHEN month < 8 THEN 1 ELSE 0 END)::text
            || CASE WHEN month BETWEEN 2 AND 7 THEN '-2' ELSE '-1' END,
          CASE WHEN month = 1 THEN make_date(year - 1, 8, 1)
               WHEN month <= 7 THEN make_date(year, 2, 1)
               ELSE make_date(year, 8, 1) END),
        ('once', 'once', NULL)
      ) AS cycle_info(cycle, period, first_day)
    )
    SELECT job.job_id, to_jsonb(periods.pay_date) AS pay_date, periods.period,
           to_jsonb(periods.first_day) AS first_day,
           CASE WHEN job.cycle = 'once' THEN job.origin = 'migration'
                ELSE coalesce(periods.first_day < class.cutover_date, false) END AS needs_legacy_confirmation
    FROM ppt.jobs AS job
    JOIN ppt.classes AS class ON class.class_id = job.class_id
    JOIN periods ON periods.cycle = job.cycle
    WHERE job.class_id = $1
    ORDER BY job.job_id COLLATE "C"
  `, [classId, readTime])
  return rows
}
