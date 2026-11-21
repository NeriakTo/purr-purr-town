DO $$
DECLARE
  role_name text;
  connection_limit integer;
BEGIN
  FOR role_name, connection_limit IN
    VALUES ('ppt_owner', -1), ('ppt_web', -1), ('ppt_agent', 5), ('ppt_backup', -1)
  LOOP
    BEGIN
      EXECUTE format('CREATE ROLE %I', role_name);
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;

    EXECUTE format(
      'ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT %s',
      role_name, connection_limit
    );
  END LOOP;
END;
$$;

ALTER ROLE ppt_agent SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE ppt_agent SET statement_timeout = '30s';
ALTER ROLE ppt_agent SET lock_timeout = '10s';
ALTER ROLE ppt_backup SET default_transaction_read_only = on;
