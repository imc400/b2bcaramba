CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text,
	"email" text NOT NULL,
	"tipo" text NOT NULL,
	"motivo" text,
	"ocurrido_en" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_events_email_idx" ON "email_events" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_events_tipo_idx" ON "email_events" USING btree ("tipo");--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_message_tipo_idx" ON "email_events" USING btree ("message_id","tipo");