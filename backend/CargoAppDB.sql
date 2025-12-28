-- ***************************************************************
-- سكربت قاعدة البيانات النهائي والمدمج (MySQL)
-- يغطي جميع واجهات العميل والموظفين
-- ***************************************************************

-- 1. الإعداد الأولي
DROP DATABASE IF EXISTS CargoAppDB;
CREATE DATABASE CargoAppDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE CargoAppDB;

-- 2. إنشاء الجداول الأساسية (يجب إنشاء الجداول التي تحتوي على PKs أولاً)

-- *********************************************************************************
-- 2.1 جدول المستخدمين (USER)
-- (يجب أن يكون الأول لأنه يُستخدم كمفتاح أجنبي في جداول كثيرة)
-- *********************************************************************************
CREATE TABLE USER (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    suite_id VARCHAR(20) UNIQUE NOT NULL, 
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    role ENUM('Client', 'Driver', 'Admin', 'SuperAdmin', 'Warehouse', 'Support', 'Accountant') NOT NULL,
    wallet_balance DECIMAL(10, 2) DEFAULT 0.00,
    kyc_status VARCHAR(20) DEFAULT 'Pending',
    is_frozen BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- *********************************************************************************
-- 2.2 جدول بيانات السائقين (DRIVER_DETAILS)
-- (يجب أن يكون قبل جدول الشحنات لأنه يُستخدم فيه كمفتاح أجنبي)
-- *********************************************************************************
CREATE TABLE DRIVER_DETAILS (
    fk_user_id INT PRIMARY KEY,
    license_number VARCHAR(50) UNIQUE,
    truck_number VARCHAR(50),
    availability_status VARCHAR(20) DEFAULT 'Available',
    FOREIGN KEY (fk_user_id) REFERENCES USER(user_id) ON DELETE CASCADE
);

-- *********************************************************************************
-- 2.3 جدول العناوين والمواقع (LOCATION)
-- (لأنه يُستخدم كمفتاح أجنبي في جدول الشحنات)
-- *********************************************************************************
CREATE TABLE LOCATION (
    address_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100),
    fk_user_id INT,
    address_line_1 VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    zip_code VARCHAR(20),
    type ENUM('Warehouse', 'Customer_Delivery') NOT NULL,
    FOREIGN KEY (fk_user_id) REFERENCES USER(user_id) ON DELETE CASCADE
);

-- *********************************************************************************
-- 2.4 جدول الشحنات (SHIPMENTS)
-- (يجب أن يكون هنا لكي تستخدم الجداول التالية مفتاحه كـ FK)
-- *********************************************************************************
CREATE TABLE SHIPMENTS (
    shipment_id VARCHAR(50) PRIMARY KEY,
    client_id INT NOT NULL,
    receiver_address_id INT NOT NULL,
    driver_id INT,
    
    shipping_method VARCHAR(50) NOT NULL,
    content_description TEXT,
    weight_kg DECIMAL(10, 2) NOT NULL,
    dimensions VARCHAR(50),
    
    image_url VARCHAR(255),
    is_insured BOOLEAN DEFAULT FALSE,
    needs_repackaging BOOLEAN DEFAULT FALSE,

    status VARCHAR(50) NOT NULL,
    estimated_cost DECIMAL(10, 2),
    creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (client_id) REFERENCES USER(user_id) ON DELETE RESTRICT,
    FOREIGN KEY (driver_id) REFERENCES DRIVER_DETAILS(fk_user_id) ON DELETE SET NULL, 
    FOREIGN KEY (receiver_address_id) REFERENCES LOCATION(address_id) ON DELETE RESTRICT
);

-- *********************************************************************************
-- 2.5 جدول المخزون (WAREHOUSE_STOCK)
-- *********************************************************************************
CREATE TABLE WAREHOUSE_STOCK (
    stock_id INT PRIMARY KEY AUTO_INCREMENT,
    shipment_id VARCHAR(50) REFERENCES SHIPMENTS(shipment_id) ON DELETE CASCADE,
    warehouse_id INT REFERENCES LOCATION(address_id) ON DELETE RESTRICT,
    shelf_location VARCHAR(100),
    in_stock_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- *********************************************************************************
-- 2.6 جدول المعاملات المالية (TRANSACTIONS)
-- *********************************************************************************
CREATE TABLE TRANSACTIONS (
    transaction_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT REFERENCES USER(user_id) ON DELETE RESTRICT,
    type VARCHAR(20) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- *********************************************************************************
-- 2.7 جدول تتبع الشحنات (SHIPMENT_TRACKING)
-- *********************************************************************************
CREATE TABLE SHIPMENT_TRACKING (
    tracking_id INT PRIMARY KEY AUTO_INCREMENT,
    shipment_id VARCHAR(50) REFERENCES SHIPMENTS(shipment_id) ON DELETE CASCADE,
    status_update VARCHAR(50) NOT NULL,
    location_details VARCHAR(255),
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- *********************************************************************************
-- 2.8 جدول التسعير (PRICING_RULES)
-- *********************************************************************************
CREATE TABLE PRICING_RULES (
    rule_id INT PRIMARY KEY AUTO_INCREMENT,
    shipping_method VARCHAR(50) NOT NULL,
    base_rate_per_kg DECIMAL(10, 2) NOT NULL,
    volumetric_factor DECIMAL(10, 2) NOT NULL,
    effective_date DATE NOT NULL
);

-- *********************************************************************************
-- 2.9 جدول الفواتير (INVOICES)
-- *********************************************************************************
CREATE TABLE INVOICES (
    invoice_id INT PRIMARY KEY AUTO_INCREMENT,
    shipment_id VARCHAR(50) NOT NULL,
    client_id INT NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    issue_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_date DATETIME,
    payment_status VARCHAR(20) NOT NULL CHECK (payment_status IN ('Pending', 'Paid', 'Failed', 'Refunded', 'Cancelled')),
    payment_method VARCHAR(50),
    
    FOREIGN KEY (client_id) REFERENCES USER(user_id) ON DELETE RESTRICT
);

-- *********************************************************************************
-- 2.10 جدول إعدادات النظام (SYSTEM_SETTINGS)
-- *********************************************************************************
CREATE TABLE SYSTEM_SETTINGS (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL
);

-- *********************************************************************************
-- 2.11 جدول أسعار الشحن (SHIPPING_RATES)
-- *********************************************************************************
CREATE TABLE SHIPPING_RATES (
    rate_id INT PRIMARY KEY AUTO_INCREMENT,
    country_name VARCHAR(50) NOT NULL,
    shipping_type VARCHAR(20) NOT NULL, -- e.g., 'Air', 'Sea'
    rate_per_kg DECIMAL(10, 2) NOT NULL,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. بيانات أولية (Seed Data)
INSERT INTO USER (full_name, email, password_hash, phone_number, role, suite_id, kyc_status) 
VALUES ('System Admin', 'admin@app.com', 'admin123', '0910000000', 'Admin', 'ADM-001', 'Active');

INSERT INTO SYSTEM_SETTINGS (setting_key, setting_value) VALUES 
('exchange_rate', '5.15');


INSERT INTO SHIPPING_RATES (country_name, shipping_type, rate_per_kg) VALUES 
('China', 'Air', 12.00),
('China', 'Sea', 350.00), -- Per CBM usually, but using rate column for simplicity
('USA', 'Air', 15.00),
('USA', 'Sea', 4.50),
('Turkey', 'Air', 6.00),
('Turkey', 'Sea', 150.00),
('Dubai', 'Air', 10.00),
('Dubai', 'Sea', 4.50);