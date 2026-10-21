-- 存量 Postgres：规则触发时机新增 beforeSend（发信前），被发信前规则拦截的邮件不入库，规则日志 mail_id 改为可空。
-- sequelize.sync 不会修改已有表的枚举值与列约束。
DO $$
DECLARE
  target record;
  enum_type text;
BEGIN
  FOR target IN
    SELECT unnest(ARRAY['t_micro_mail_mail_gateway_rule', 't_micro_mail_mail_gateway_rule_log']) AS table_name
  LOOP
    SELECT udt_name INTO enum_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = target.table_name AND column_name = 'direction';

    IF enum_type IS NOT NULL AND EXISTS (
      SELECT 1 FROM pg_type WHERE typname = enum_type AND typtype = 'e'
    ) THEN
      EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS %L BEFORE %L', enum_type, 'beforeSend', 'send');
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 't_micro_mail_mail_gateway_rule_log' AND column_name = 'mail_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.t_micro_mail_mail_gateway_rule_log ALTER COLUMN mail_id DROP NOT NULL;
  END IF;
END $$;
