-- Create flash_sales table
CREATE TABLE flash_sales (
    sale_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP
);

-- Create flash_sale_products join table
CREATE TABLE flash_sale_products (
    sale_id UUID NOT NULL,
    product_id UUID NOT NULL,
    PRIMARY KEY (sale_id, product_id),
    FOREIGN KEY (sale_id) REFERENCES flash_sales(sale_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);
