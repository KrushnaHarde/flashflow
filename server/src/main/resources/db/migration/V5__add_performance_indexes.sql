-- V5__add_performance_indexes.sql
-- Optimize reservation lookups by user and product
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_product_id ON reservations(product_id);

-- Optimize outbox event polling sorting by status and created_at
CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created_at ON outbox_events(status, created_at);
