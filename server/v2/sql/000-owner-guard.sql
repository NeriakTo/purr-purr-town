DO $$
BEGIN
  IF current_user <> 'ppt_owner' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Web state installation requires ppt_owner';
  END IF;
END;
$$;
