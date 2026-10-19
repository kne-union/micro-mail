-- 存量 Postgres：邮箱网关按登录用户隔离。系统默认标签/模版/分类（level = 0）不写 user_id，查询时与当前用户的数据 OR。
-- sequelize.sync 不会给已有表 ADD COLUMN。
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    't_micro_mail_mail_gateway_contact',
    't_micro_mail_mail_gateway_label',
    't_micro_mail_mail_gateway_template',
    't_micro_mail_mail_gateway_template_category',
    't_micro_mail_mail_gateway_rule',
    't_micro_mail_mail_gateway_rule_log'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = target
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target AND column_name = 'user_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN user_id bigint', target);
    END IF;
  END LOOP;
END $$;
