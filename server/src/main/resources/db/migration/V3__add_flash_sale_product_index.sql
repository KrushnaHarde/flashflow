-- Add index to flash sale product table to improve queries
CREATE INDEX idx_flash_sale_products_product_id ON flash_sale_products(product_id);
