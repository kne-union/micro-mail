-- 存量 Postgres：邮箱账号增加默认邮箱标记。按用户回填默认邮箱由 @kne/fastify-mail-gateway 启动时完成。
-- sequelize.sync 不会给已有表 ADD COLUMN。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 't_micro_mail_mail_gateway_account'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 't_micro_mail_mail_gateway_account' AND column_name = 'is_default'
  ) THEN
    ALTER TABLE public.t_micro_mail_mail_gateway_account ADD COLUMN is_default boolean DEFAULT false;
  END IF;
END $$;
