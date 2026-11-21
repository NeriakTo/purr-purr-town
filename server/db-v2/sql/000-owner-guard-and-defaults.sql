DO $$
BEGIN
  IF current_user <> 'ppt_owner' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Database installation requires ppt_owner';
  END IF;
END;
$$;

-- Revoke the global default so it applies to functions in every schema.
ALTER DEFAULT PRIVILEGES FOR ROLE ppt_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
