-- 存量 Postgres：规则触发时机新增 schedule（定时），按时间窗口统计未读邮件后批量执行动作。
-- sequelize.sync 不会修改已有表的枚举值；新列网关启动时也会补齐，这里一并补上便于手动迁移。
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
      EXECUTE format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS %L', enum_type, 'schedule');
    END IF;
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.t_micro_mail_mail_gateway_rule ADD COLUMN IF NOT EXISTS "trigger" JSON;
ALTER TABLE IF EXISTS public.t_micro_mail_mail_gateway_rule ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE IF EXISTS public.t_micro_mail_mail_gateway_rule_log ADD COLUMN IF NOT EXISTS mail_ids JSON;
