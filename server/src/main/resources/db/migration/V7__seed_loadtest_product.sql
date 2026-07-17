-- Clean up existing seed data to allow safe rerun
DELETE FROM flash_sale_products WHERE product_id = '5169a9b2-3b2d-4bf8-a46c-7e61e06cd2df';
DELETE FROM flash_sales WHERE sale_id = '2bf7bf4c-c045-4202-b286-d24269e8db2c';
DELETE FROM inventory WHERE product_id = '5169a9b2-3b2d-4bf8-a46c-7e61e06cd2df';
DELETE FROM products WHERE product_id = '5169a9b2-3b2d-4bf8-a46c-7e61e06cd2df';

-- 1. Insert active Product
INSERT INTO products (product_id, name, description, cover_img, price, status, created_at)
VALUES (
    '5169a9b2-3b2d-4bf8-a46c-7e61e06cd2df', 
    'High-Concurrency Super Running Shoes', 
    'Engineered for maximum stress load-testing.', 
    'http://localhost/shoes.jpg', 
    150.00, 
    'ACTIVE', 
    CURRENT_TIMESTAMP
);

-- 2. Insert corresponding Inventory
INSERT INTO inventory (product_id, total_stock, available_stock, reserved_stock, updated_at, version)
VALUES (
    '5169a9b2-3b2d-4bf8-a46c-7e61e06cd2df', 
    1000000, 
    1000000, 
    0, 
    CURRENT_TIMESTAMP, 
    0
);

-- 3. Insert active Flash Sale event (started 1 hour ago, ending in 24 hours)
INSERT INTO flash_sales (sale_id, name, start_time, end_time)
VALUES (
    '2bf7bf4c-c045-4202-b286-d24269e8db2c', 
    'Concurrent Flash Sale Event', 
    CURRENT_TIMESTAMP - INTERVAL '1 hour', 
    CURRENT_TIMESTAMP + INTERVAL '24 hours'
);

-- 4. Associate product with the flash sale
INSERT INTO flash_sale_products (sale_id, product_id)
VALUES (
    '2bf7bf4c-c045-4202-b286-d24269e8db2c', 
    '5169a9b2-3b2d-4bf8-a46c-7e61e06cd2df'
);
