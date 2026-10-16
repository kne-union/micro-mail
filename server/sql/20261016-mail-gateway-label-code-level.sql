-- 存量 Postgres：补齐 mail_gateway_label 的 code / level（系统默认标签依赖这两列）
-- sequelize.sync 不会给已有表 ADD COLUMN；应用启动 includeDefaultLabels 前须先有列
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 't_micro_mail_mail_gateway_label'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 't_micro_mail_mail_gateway_label'
        AND column_name = 'code'
    ) THEN
      ALTER TABLE "public"."t_micro_mail_mail_gateway_label"
        ADD COLUMN "code" character varying(255);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 't_micro_mail_mail_gateway_label'
        AND column_name = 'level'
    ) THEN
      ALTER TABLE "public"."t_micro_mail_mail_gateway_label"
        ADD COLUMN "level" integer DEFAULT 1;
    END IF;
  END IF;
END $$;
