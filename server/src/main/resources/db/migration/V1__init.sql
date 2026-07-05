-- Create users table
CREATE TABLE users (
    user_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP
);

-- Create refresh_tokens table
CREATE TABLE refresh_tokens (
    token_id UUID PRIMARY KEY,
    token VARCHAR(255) NOT NULL UNIQUE,
    user_id UUID NOT NULL,
    expiry_date TIMESTAMP NOT NULL
);

-- Create products table
CREATE TABLE products (
    product_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(1000),
    cover_img VARCHAR(255),
    price NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

-- Create inventory table
CREATE TABLE inventory (
    product_id UUID PRIMARY KEY,
    total_stock INTEGER NOT NULL,
    available_stock INTEGER NOT NULL,
    reserved_stock INTEGER NOT NULL,
    updated_at TIMESTAMP,
    version BIGINT DEFAULT 0 NOT NULL
);

-- Create reservations table
CREATE TABLE reservations (
    reservation_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP
);

-- Create orders table
CREATE TABLE orders (
    order_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    product_id UUID NOT NULL,
    reservation_id UUID NOT NULL UNIQUE,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP
);

-- Create payments table
CREATE TABLE payments (
    payment_id UUID PRIMARY KEY,
    order_id UUID NOT NULL UNIQUE,
    amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    payment_gateway_id VARCHAR(255),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP
);

-- Create outbox_events table
CREATE TABLE outbox_events (
    event_id UUID PRIMARY KEY,
    aggregate_type VARCHAR(255) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    payload TEXT NOT NULL,
    status VARCHAR(50) NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP
);

-- Create idempotency_keys table
CREATE TABLE idempotency_keys (
    idempotency_key VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL,
    product_id UUID,
    request_hash VARCHAR(255),
    status VARCHAR(50) NOT NULL,
    response_snapshot TEXT,
    order_id UUID,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    PRIMARY KEY (idempotency_key, user_id)
);

-- Create required missing indexes
CREATE INDEX idx_reservations_status_expires_at ON reservations(status, expires_at);
CREATE INDEX idx_outbox_events_status ON outbox_events(status);
CREATE INDEX idx_orders_reservation_id ON orders(reservation_id);
CREATE INDEX idx_payments_order_id ON payments(order_id);
