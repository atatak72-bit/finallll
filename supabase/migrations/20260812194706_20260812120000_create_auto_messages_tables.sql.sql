/*
# Auto Messages tables

## Overview
- message_templates: per-store message templates with body + trigger slot
- auto_message_triggers: per-store trigger bindings (which template fires on which event)
- customer_messages: inbound eBay buyer messages (for future AI auto-responder)

## Security
RLS enabled, anon+authenticated CRUD (no-auth pattern).
*/

CREATE TABLE IF NOT EXISTS message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL,
  name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_message_templates" ON message_templates;
CREATE POLICY "select_message_templates" ON message_templates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_message_templates" ON message_templates;
CREATE POLICY "insert_message_templates" ON message_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_message_templates" ON message_templates;
CREATE POLICY "update_message_templates" ON message_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_message_templates" ON message_templates;
CREATE POLICY "delete_message_templates" ON message_templates FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS auto_message_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL UNIQUE,
  new_order_enabled boolean NOT NULL DEFAULT false,
  new_order_template_id uuid,
  tracker_added_enabled boolean NOT NULL DEFAULT false,
  tracker_added_template_id uuid,
  order_delivered_enabled boolean NOT NULL DEFAULT false,
  order_delivered_template_id uuid,
  feedback_request_enabled boolean NOT NULL DEFAULT false,
  feedback_request_template_id uuid,
  feedback_send_after_days integer NOT NULL DEFAULT 3,
  ai_auto_responder_enabled boolean NOT NULL DEFAULT false,
  ai_provider_api_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE auto_message_triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_auto_message_triggers" ON auto_message_triggers;
CREATE POLICY "select_auto_message_triggers" ON auto_message_triggers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_auto_message_triggers" ON auto_message_triggers;
CREATE POLICY "insert_auto_message_triggers" ON auto_message_triggers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_auto_message_triggers" ON auto_message_triggers;
CREATE POLICY "update_auto_message_triggers" ON auto_message_triggers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_auto_message_triggers" ON auto_message_triggers;
CREATE POLICY "delete_auto_message_triggers" ON auto_message_triggers FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS customer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL,
  ebay_order_id text,
  buyer_username text,
  message_body text,
  ai_response_draft text,
  ai_responded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE customer_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_customer_messages" ON customer_messages;
CREATE POLICY "select_customer_messages" ON customer_messages FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_customer_messages" ON customer_messages;
CREATE POLICY "insert_customer_messages" ON customer_messages FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_customer_messages" ON customer_messages;
CREATE POLICY "update_customer_messages" ON customer_messages FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_customer_messages" ON customer_messages;
CREATE POLICY "delete_customer_messages" ON customer_messages FOR DELETE TO anon, authenticated USING (true);
