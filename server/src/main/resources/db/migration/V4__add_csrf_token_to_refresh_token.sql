-- Add csrf_token to refresh_tokens table to support double-submit CSRF protection
ALTER TABLE refresh_tokens ADD COLUMN csrf_token VARCHAR(255);
