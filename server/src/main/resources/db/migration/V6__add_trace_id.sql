-- db/migration/V6__add_trace_id.sql
ALTER TABLE reservations ADD COLUMN trace_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN trace_id VARCHAR(255);
