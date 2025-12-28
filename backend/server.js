const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');
const path = require('path');

const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity
        methods: ["GET", "POST"]
    }
});

const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../'))); // Serve frontend files from parent directory

// ... (Existing Routes) ...

// ==========================================
// SOCKET.IO REAL-TIME LOGIC
// ==========================================

io.on('connection', (socket) => {
    console.log('⚡ User connected:', socket.id);

    // Driver joins their personal room (optional, but good for direct messaging)
    socket.on('join_driver_room', (driverId) => {
        socket.join('driver_' + driverId);
        console.log(`Driver ${driverId} joined room`);
    });

    // Handle Driver Accepting a Shipment
    socket.on('accept_shipment', (data) => {
        const { driverId, shipmentId } = data;
        console.log(`📦 Driver ${driverId} attempting to accept Shipment ${shipmentId}`);

        // 1. Check if shipment is still available (Status = 'Pending')
        db.query("SELECT status FROM SHIPMENTS WHERE shipment_id = ?", [shipmentId], (err, results) => {
            if (err) return console.error(err);

            if (results.length > 0 && results[0].status === 'Pending') {
                // WINNER! 🏆

                // 2. Assign to Driver
                db.query("UPDATE SHIPMENTS SET status = 'OutForDelivery', driver_id = ? WHERE shipment_id = ?", [driverId, shipmentId], (err, result) => {
                    if (err) return console.error(err);

                    // 3. Notify the Winner
                    socket.emit('assignment_success', { shipmentId, message: 'مبروك! الشحنة لك. 🎉' });

                    // 4. Notify Everyone Else (to remove the request)
                    io.emit('shipment_taken', { shipmentId });

                    // 5. Log it
                    console.log(`✅ Shipment ${shipmentId} assigned to Driver ${driverId}`);
                });

            } else {
                // TOO LATE! 😢
                socket.emit('assignment_failed', { shipmentId, message: 'عذراً، سبقتك بها سائق آخر! 🐢' });
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});



// Login Route
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT * FROM USER WHERE email = ? AND password_hash = ?';
    db.query(query, [email, password], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });

        if (results.length > 0) {
            const user = results[0];
            const role = user.role.toLowerCase();

            // Check if account is frozen
            if (user.is_frozen) {
                return res.status(403).json({ success: false, message: 'تم تجميد حسابك مؤقتاً. يرجى التواصل مع الإدارة.' }); // Account frozen message
            }

            // Check KYC Status for Drivers
            if (role === 'driver' && user.kyc_status !== 'Active') {
                return res.status(403).json({ success: false, message: 'حسابك لا يزال قيد المراجعة. يرجى الانتظار حتى يتم قبول طلبك.' });
            }

            // Send simplified user data including full name and warehouse
            res.json({
                success: true,
                user: {
                    user_id: user.user_id,
                    email: user.email,
                    full_name: user.full_name,
                    role: role,
                    assigned_warehouse: user.assigned_warehouse || null
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
        }
    });
});

// Register Route
app.post('/api/register', (req, res) => {
    console.log('📩 Register Request Body:', req.body); // DEBUG
    const { name, email, phone, password, role, carType, generatedLicense } = req.body;

    // Validation
    if (!name || !email || !phone || !password) {
        return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
    }

    if (!email.includes('@') || !email.includes('.com')) {
        return res.status(400).json({ success: false, message: 'البريد الإلكتروني غير صالح' });
    }

    const phoneRegex = /^(091|092|093|094)\d{7}$/;
    if (!phoneRegex.test(phone) || phone.length > 10) {
        return res.status(400).json({ success: false, message: 'رقم الهاتف غير صالح' });
    }

    if (password.length <= 8) {
        return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون أكثر من 8 خانات' });
    }

    const checkQuery = 'SELECT email FROM USER WHERE email = ?';
    db.query(checkQuery, [email], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        if (results.length > 0) return res.status(409).json({ success: false, message: 'البريد الإلكتروني مسجل بالفعل' });

        const suite_id = 'LY-' + Math.floor(100000 + Math.random() * 900000);

        // Determine Role
        const userRole = role === 'driver' ? 'Driver' : 'Client';
        const kycStatus = role === 'driver' ? 'Pending' : 'Active';

        console.log('👤 Registering Role:', userRole, 'Status:', kycStatus); // DEBUG

        const insertQuery = 'INSERT INTO USER (full_name, email, phone_number, password_hash, role, suite_id, kyc_status) VALUES (?, ?, ?, ?, ?, ?, ?)';
        db.query(insertQuery, [name, email, phone, password, userRole, suite_id, kycStatus], (err, result) => {
            if (err) {
                console.error('❌ Insert Error:', err); // DEBUG
                return res.status(500).json({ success: false, message: 'Registration failed' });
            }

            const userId = result.insertId;
            console.log('✅ User Inserted ID:', userId); // DEBUG

            if (userRole === 'Driver') {
                const license = 'LIC-' + Math.floor(10000 + Math.random() * 90000);
                const truck = carType || 'Unknown';

                const driverQuery = 'INSERT INTO DRIVER_DETAILS (fk_user_id, license_number, truck_number) VALUES (?, ?, ?)';
                db.query(driverQuery, [userId, license, truck], (err, driverResult) => {
                    if (err) console.error('Driver Details Info Error:', err);
                    res.json({ success: true, message: 'تم إرسال طلبك بنجاح! سيتم مراجعته من قبل الإدارة.' });
                });
            } else {
                res.json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
            }
        });
    });
});

const resetService = require('./reset_service');

app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;
    db.query('SELECT * FROM USER WHERE email = ?', [email], (err, results) => {
        if (err || results.length === 0) {
            return res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
        }
        const token = resetService.createToken(email);
        resetService.sendResetEmail(email, token);
        res.json({ success: true, message: 'Reset link sent to your email (Check Server Console).' });
    });
});

app.post('/api/reset-password', (req, res) => {
    const { token, newPassword } = req.body;
    const email = resetService.verifyToken(token);
    if (!email) return res.status(400).json({ success: false, message: 'Invalid or expired token.' });
    if (newPassword.length <= 8) return res.status(400).json({ success: false, message: 'Password must be > 8 chars.' });

    db.query('UPDATE USER SET password_hash = ? WHERE email = ?', [newPassword, email], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        resetService.consumeToken(token);
        res.json({ success: true, message: 'Password updated successfully. Login now.' });
    });
});

// User Details API
app.get('/api/user-details', (req, res) => {
    const userId = req.query.id;
    if (!userId) return res.status(400).json({ success: false, message: 'User ID required' });

    const query = 'SELECT user_id, suite_id, full_name, email, phone_number, role, wallet_balance FROM USER WHERE user_id = ?';
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        res.json({ success: true, user: results[0] });
    });
});

// Driver API: Get Full Profile Stats
app.get('/api/driver/profile', (req, res) => {
    const driverId = req.query.driverId;
    if (!driverId) return res.status(400).json({ success: false, message: 'ID Required' });

    // 1. Get User Info & Driver Details & Wallet
    const queryUser = `
        SELECT u.full_name, u.phone_number, u.suite_id, u.wallet_balance, u.created_at,
               d.license_number, d.truck_number, d.availability_status 
        FROM USER u
        LEFT JOIN DRIVER_DETAILS d ON u.user_id = d.fk_user_id
        WHERE u.user_id = ?
    `;

    db.query(queryUser, [driverId], (err, userRes) => {
        if (err || userRes.length === 0) return res.status(500).json({ success: false });

        const user = userRes[0];

        // 2. Get Stats: Delivered Count AND Active Count AND Handed Over
        // We calculate net cash here too
        const queryStats = `
            SELECT 
                SUM(CASE WHEN status = 'Delivered' THEN estimated_cost ELSE 0 END) as total_collected,
                SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status IN ('Assigned', 'OutForDelivery', 'InTransit') THEN 1 ELSE 0 END) as active
            FROM SHIPMENTS 
            WHERE driver_id = ?
        `;

        db.query(queryStats, [driverId], (err, statsRes) => {
            const completed = statsRes[0]?.completed || 0;
            const active = statsRes[0]?.active || 0;
            const totalCollected = statsRes[0]?.total_collected || 0;

            // Get Handovers
            db.query("SELECT SUM(amount) as handed_over FROM TRANSACTIONS WHERE user_id = ? AND type = 'Custody_Handover'", [driverId], (err, txRes) => {
                const totalHandedOver = txRes[0]?.handed_over || 0;
                const netCustody = totalCollected - totalHandedOver;

                // Calculate Experience
                const joinDate = new Date(user.created_at);
                const now = new Date();
                const diffTime = Math.abs(now - joinDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                let experience = diffDays + ' يوم';
                if (diffDays > 365) experience = Math.floor(diffDays / 365) + ' عام';

                res.json({
                    success: true,
                    profile: {
                        name: user.full_name,
                        id_code: user.suite_id,
                        phone: user.phone_number,
                        truck: user.truck_number || 'N/A',
                        availability_status: user.availability_status || 'Available',
                        wallet_balance: netCustody.toFixed(2), // Use Net Custody instead of raw wallet_balance
                        stats: {
                            completed: completed,
                            active: active,
                            commitment: '98%',
                            experience: experience
                        }
                    }
                });
            });
        });
    });
});

// Wallet Transactions API
app.get('/api/wallet/transactions', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ success: false, message: 'User ID required' });

    const query = 'SELECT transaction_id, type, amount, transaction_date, description FROM TRANSACTIONS WHERE user_id = ? ORDER BY transaction_date DESC LIMIT 10';
    db.query(query, [userId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });

        res.json({ success: true, transactions: results });
    });
});

// Admin API: Get All Active Drivers (Real Data)
app.get('/api/admin/drivers', (req, res) => {
    const query = `
        SELECT 
            u.user_id, 
            u.full_name, 
            u.phone_number, 
            u.wallet_balance, 
            u.is_frozen,
            d.availability_status,
            d.truck_number,
            (SELECT COUNT(*) FROM SHIPMENTS s WHERE s.driver_id = u.user_id AND s.status IN ('OutForDelivery', 'PickedUp', 'InTransit')) as active_shipments
        FROM USER u
        LEFT JOIN DRIVER_DETAILS d ON u.user_id = d.fk_user_id
        WHERE u.role = 'Driver' AND u.kyc_status = 'Active'
        ORDER BY u.created_at DESC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Drivers Fetch Error:', err);
            return res.status(500).json({ success: false, message: 'DB Error' });
        }
        res.json({ success: true, drivers: results });
    });
});

// Admin API: Get Pending Drivers
app.get('/api/admin/pending-drivers', (req, res) => {
    console.log('🔍 Fetching Pending Drivers...'); // DEBUG
    db.query("SELECT * FROM USER WHERE role = 'Driver' AND kyc_status = 'Pending'", (err, results) => {
        if (err) {
            console.error('❌ DB Error:', err); // DEBUG
            return res.status(500).json({ success: false, message: 'DB Error' });
        }
        console.log(`✅ Found ${results.length} Pending Drivers`); // DEBUG
        res.json({ success: true, drivers: results });
    });
});

// Admin API: Get Single Driver Details
app.get('/api/admin/driver/:id', (req, res) => {
    const id = req.params.id;
    const query = `
        SELECT u.*, d.truck_number, d.license_number 
        FROM USER u 
        LEFT JOIN DRIVER_DETAILS d ON u.user_id = d.fk_user_id 
        WHERE u.user_id = ?`;
    db.query(query, [id], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ success: false, message: 'Driver not found' });
        res.json({ success: true, driver: results[0] });
    });
});

// Admin API: Approve Driver
app.post('/api/admin/approve-driver', (req, res) => {
    const { id } = req.body;
    console.log('✅ Approving Driver ID:', id); // DEBUG
    db.query("UPDATE USER SET kyc_status = 'Active' WHERE user_id = ?", [id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, message: 'Driver Approved' });
    });
});

// Admin API: Get System Settings (Exchange Rate & Domestic Price)
app.get('/api/admin/settings', (req, res) => {
    db.query("SELECT * FROM SYSTEM_SETTINGS", (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        const settings = {};
        results.forEach(row => settings[row.setting_key] = row.setting_value);
        res.json({ success: true, settings });
    });
});

// Admin API: Update System Settings
app.post('/api/admin/settings', (req, res) => {
    console.log('📝 Received Settings Update:', req.body); // DEBUG
    const { exchange_rate, domestic_land_price } = req.body;

    // Helper function to update or insert
    const upsertSetting = (key, value, callback) => {
        db.query("SELECT * FROM SYSTEM_SETTINGS WHERE setting_key = ?", [key], (err, results) => {
            if (err) return callback(err);

            if (results.length > 0) {
                db.query("UPDATE SYSTEM_SETTINGS SET setting_value = ? WHERE setting_key = ?", [value, key], callback);
            } else {
                db.query("INSERT INTO SYSTEM_SETTINGS (setting_key, setting_value) VALUES (?, ?)", [key, value], callback);
            }
        });
    };

    upsertSetting('exchange_rate', exchange_rate, (err) => {
        if (err) {
            console.error('❌ Error saving exchange_rate:', err);
            return res.status(500).json({ success: false, message: 'DB Error on Exchange Rate' });
        }

        upsertSetting('domestic_land_price', domestic_land_price, (err) => {
            if (err) {
                console.error('❌ Error saving domestic_land_price:', err);
                return res.status(500).json({ success: false, message: 'DB Error on Domestic Price' });
            }
            console.log('✅ Settings Updated Successfully');
            res.json({ success: true, message: 'Settings Updated' });
        });
    });
});

// Migration: Ensure domestic_land_price exists
const checkSettingQuery = "SELECT * FROM SYSTEM_SETTINGS WHERE setting_key = 'domestic_land_price'";
db.query(checkSettingQuery, (err, results) => {
    if (!err && results.length === 0) {
        db.query("INSERT INTO SYSTEM_SETTINGS (setting_key, setting_value) VALUES ('domestic_land_price', '0')", (err) => {
            if (!err) console.log("✅ Migration: Added 'domestic_land_price' to SYSTEM_SETTINGS.");
        });
    }
});

// Admin API: Get Shipping Rates
app.get('/api/admin/shipping-rates', (req, res) => {
    db.query("SELECT * FROM SHIPPING_RATES", (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, rates: results });
    });
});

// Admin API: Update Shipping Rate
app.post('/api/admin/shipping-rates', (req, res) => {
    console.log('📦 Updating Rate:', req.body); // DEBUG
    const { id, rate } = req.body;
    db.query("UPDATE SHIPPING_RATES SET rate_per_kg = ? WHERE rate_id = ?", [rate, id], (err, result) => {
        if (err) {
            console.error('❌ Update Rate Error:', err);
            return res.status(500).json({ success: false, message: 'DB Error' });
        }
        res.json({ success: true, message: 'Rate Updated' });
    });
});
// Admin API: Delete Shipping Rates for a Country
app.delete('/api/admin/country-rates/:name', (req, res) => {
    const countryName = req.params.name;
    const query = "DELETE FROM SHIPPING_RATES WHERE country_name = ?";
    db.query(query, [countryName], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'DB Error' });
        }
        res.json({ success: true, message: '✅ تم حذف الدولة والأسعار' });
    });
});

// Public/Client API: Get Pricing Rules for Estimation
app.get('/api/pricing-rules', (req, res) => {
    db.query("SELECT * FROM SHIPPING_RATES", (err, results) => { // Assuming SHIPPING_RATES is the table name used in admin API previously viewed. 
        // Wait, Steps above showed PRICING_RULES table created in SQL but 'SHIPPING_RATES' used in Admin API lines 398.
        // Let's assume SHIPPING_RATES is the active one if Admin uses it.
        // Actually, Step 735 showed CREATE TABLE PRICING_RULES. 
        // But Step 641 showed GET /api/admin/shipping-rates querying SHIPPING_RATES.
        // This implies inconsistency. I should use SHIPPING_RATES if that's what Admin sets.
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, rules: results });
    });
});


// Admin API: Get All Warehouses (from LOCATION table)
app.get('/api/admin/warehouses', (req, res) => {
    db.query("SELECT * FROM LOCATION WHERE type = 'Warehouse'", (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, warehouses: results });
    });
});

// Admin API: Get Distinct Countries (for Dropdown)
app.get('/api/admin/countries', (req, res) => {
    db.query("SELECT DISTINCT country_name FROM SHIPPING_RATES", (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        // Return list of strings
        const countries = results.map(r => r.country_name);
        res.json({ success: true, countries });
    });
});

// Admin API: Add New Warehouse
app.post('/api/admin/warehouse', (req, res) => {
    const { name, city, address, country } = req.body;
    // We store Warehouse as a LOCATION with type='Warehouse'
    const query = "INSERT INTO LOCATION (name, country, city, address_line_1, type, fk_user_id) VALUES (?, ?, ?, ?, 'Warehouse', 1)";
    db.query(query, [name, country, city, address], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, message: '✅ تم إضافة المخزن بنجاح' });
    });
});

// Admin API: Delete Warehouse
app.delete('/api/admin/warehouse/:id', (req, res) => {
    db.query("DELETE FROM LOCATION WHERE address_id = ? AND type = 'Warehouse'", [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, message: '✅ تم الحذف' });
    });
});

// Admin API: Reports Summary
app.get('/api/admin/reports/summary', (req, res) => {
    const summary = {
        clients: 0,
        drivers: 0,
        shipments: { total: 0, active: 0, delivered: 0, pending: 0 },
        revenue: 0
    };

    // Parallel Queries (Basic Callback Hell avoidance for simplicity)
    db.query("SELECT COUNT(*) as count FROM USER WHERE role='Client'", (err, r1) => {
        if (!err) summary.clients = r1[0].count;

        db.query("SELECT COUNT(*) as count FROM USER WHERE role='Driver'", (err, r2) => {
            if (!err) summary.drivers = r2[0].count;

            db.query("SELECT status, COUNT(*) as count FROM SHIPMENTS GROUP BY status", (err, r3) => {
                if (!err) {
                    let total = 0;
                    r3.forEach(row => {
                        total += row.count;
                        if (row.status === 'Delivered') summary.shipments.delivered += row.count;
                        else if (row.status === 'Pending') summary.shipments.pending += row.count;
                        else summary.shipments.active += row.count;
                    });
                    summary.shipments.total = total;
                }

                // Mock Revenue for now as we don't have filled Invoices table
                summary.revenue = 12500.00; // Mock

                res.json({ success: true, summary });
            });
        });
    });
});

// Migration: Add assigned_warehouse column if not exists
const migrationQuery = "SHOW COLUMNS FROM USER LIKE 'assigned_warehouse'";
db.query(migrationQuery, (err, result) => {
    if (!err && result.length === 0) {
        db.query("ALTER TABLE USER ADD COLUMN assigned_warehouse VARCHAR(100)", (err) => {
            if (!err) console.log("✅ Migration: Added 'assigned_warehouse' column to USER table.");
        });
    }
});

// Admin API: Get All Employees (Modified to include warehouse)
app.get('/api/admin/employees', (req, res) => {
    db.query("SELECT user_id, full_name, email, role, phone_number, assigned_warehouse, created_at FROM USER WHERE role IN ('Warehouse', 'Support', 'Accountant')", (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, employees: results });
    });
});

// Admin API: Assign Warehouse to Employee
app.post('/api/admin/assign-warehouse', (req, res) => {
    const { userId, warehouseName } = req.body;
    db.query("UPDATE USER SET assigned_warehouse = ? WHERE user_id = ?", [warehouseName, userId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, message: '✅ تم تعيين المستودع بنجاح' });
    });
});

// Admin API: Add New Employee
app.post('/api/admin/add-employee', (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    if (password.length <= 8) {
        return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون أكثر من 8 خانات' });
    }

    const suiteId = 'EMP-' + Math.floor(1000 + Math.random() * 9000);

    const query = "INSERT INTO USER (full_name, email, password_hash, role, suite_id, kyc_status, assigned_warehouse) VALUES (?, ?, ?, ?, ?, 'Active', ?)";

    db.query(query, [name, email, password, role, suiteId, assigned_warehouse || null], (err, result) => {
        if (err) {
            console.error(err);
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل مسبقاً' });
            return res.status(500).json({ success: false, message: 'Database Error' });
        }
        res.json({ success: true, message: 'Employee Added' });
    });
});

// Admin API: Get All Employees
app.get('/api/admin/employees', (req, res) => {
    db.query("SELECT user_id, full_name, role, email FROM USER WHERE role IN ('Warehouse', 'Support', 'Accountant')", (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, employees: results });
    });
});

// Migration: Add origin_warehouse to SHIPMENTS
db.query("SHOW COLUMNS FROM SHIPMENTS LIKE 'origin_warehouse'", (err, results) => {
    if (!err && results.length === 0) {
        db.query("ALTER TABLE SHIPMENTS ADD COLUMN origin_warehouse VARCHAR(100)", (err) => {
            if (!err) console.log("✅ Migration: Added 'origin_warehouse' column to SHIPMENTS.");
        });
    }
});

// Migration: Add payment_status to SHIPMENTS
db.query("SHOW COLUMNS FROM SHIPMENTS LIKE 'payment_status'", (err, results) => {
    if (!err && results.length === 0) {
        db.query("ALTER TABLE SHIPMENTS ADD COLUMN payment_status VARCHAR(50) DEFAULT 'Unpaid'", (err) => {
            if (!err) console.log("✅ Migration: Added 'payment_status' column to SHIPMENTS.");
        });
    }
});

// Client API: Create New Shipment (Land/Local)
app.post('/api/shipments', (req, res) => {
    const { client_id, receiver_address_id, shipping_method, weight_kg, content_description, payment_responsibility, type } = req.body;

    const shipmentId = 'TRK-' + Math.floor(100000 + Math.random() * 900000);

    // Fetch Domestic Price from Settings
    db.query("SELECT domestic_land_price FROM SYSTEM_SETTINGS LIMIT 1", (err, setRes) => {
        let cost = 0;
        if (!err && setRes.length > 0) {
            cost = setRes[0].domestic_land_price || 0;
        }

        const query = `
            INSERT INTO SHIPMENTS (
                shipment_id, client_id, receiver_address_id, 
                shipping_method, weight_kg, status, 
                estimated_cost, origin_warehouse, payment_status
            ) VALUES (?, ?, ?, ?, ?, 'Pending', ?, 'Libya', ?)
        `;
        // Note: origin_warehouse hardcoded to Libya for local land shipments

        db.query(query, [shipmentId, client_id, receiver_address_id, shipping_method, weight_kg, cost, payment_responsibility], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ success: false, message: 'DB Error: ' + err.message });
            }
            res.json({ success: true, message: 'Shipment Created', shipment: { shipment_id: shipmentId, estimated_cost: cost } });
        });
    });
});

// Warehouse API: Register Inbound Shipment
app.post('/api/warehouse/inbound', (req, res) => {
    const { clientCode, weight, trackingNumber, currentWarehouse } = req.body;
    let userId;

    // 1. Resolve Client ID
    // Expecting clientCode like "LY-1234" or just "1234"
    const suiteIdSearch = clientCode.includes('LY-') ? clientCode.replace('LY-', '') : clientCode;

    // Try finding by Suite ID (e.g., ADM-001 or just the number part if we had a mapping, but for now strict match)
    // Actually, in this system, suite_id is stored as "ADM-001". 
    // If the user inputs "LY-1234", we might need to search for "LY-1234" in `suite_id` or similar.
    // Let's assume clientCode IS the unique identifier or email for now to be safe, 
    // OR search where suite_id LIKE %search%

    const findUserQuery = "SELECT user_id FROM USER WHERE suite_id = ? OR email = ? OR full_name LIKE ?";
    db.query(findUserQuery, [clientCode, clientCode, `%${clientCode}%`], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error finding client' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Client not found' });

        userId = results[0].user_id;
        const shipmentId = 'TRK-' + Math.floor(100000 + Math.random() * 900000);

        // Insert Shipment with Status 'InWarehouse' (waiting for client choice)
        // origin_warehouse came from the frontend (logged in admin's assigned warehouse)
        const insertQuery = `
            INSERT INTO SHIPMENTS (
                shipment_id, client_id, receiver_address_id, 
                weight_kg, status, origin_warehouse, 
                shipping_method, estimated_cost
            ) VALUES (?, ?, 1, ?, 'InWarehouse', ?, NULL, NULL)
        `;
        // Note: receiver_address_id hardcoded to 1 (placeholder) or needs to be fetched from client's default address. 
        // For now, 1 is safer if we ensure an address exists, or we should handle this gracefully.
        // Better: Find first address of user, or set to null if allowed (schema says NOT NULL usually).
        // Let's quickly get an address id or use a default if we can't find one.

        // Resolve Warehouse Country
        const warehouseName = currentWarehouse || 'China';

        db.query("SELECT country FROM LOCATION WHERE name = ? AND type='Warehouse' LIMIT 1", [warehouseName], (err, locRes) => {
            // Default to warehouseName itself if not found (fallback) OR 'China'
            // If warehouseName is already "China" (country), it might not be in LOCATION as name.
            // But usually it's a name like "China Warehouse".
            // Let's use flexible fallback.
            let originCountry = warehouseName;
            if (locRes && locRes.length > 0 && locRes[0].country) {
                originCountry = locRes[0].country;
            }

            // Now creating shipment with originCountry
            db.query("SELECT address_id FROM LOCATION WHERE fk_user_id = ? LIMIT 1", [userId], (err, addrRes) => {
                const addressId = (addrRes && addrRes.length > 0) ? addrRes[0].address_id : 1;

                db.query(insertQuery, [shipmentId, userId, weight, originCountry, addressId], (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ success: false, message: 'Failed to create shipment' });
                    }
                    res.json({ success: true, message: '✅ Shipment Registered. Waiting for client action.', shipmentId });
                });
            });
        });
    });
});

// Client API: Select Shipping Method & Calculate Price
app.post('/api/client/shipment-method', (req, res) => {
    const { shipmentId, method } = req.body; // method: 'Air' or 'Sea'

    // 1. Get Shipment Details (Weight & Origin)
    db.query("SELECT weight_kg, origin_warehouse FROM SHIPMENTS WHERE shipmentId = ?", [shipmentId], (err, sRes) => {
        // Note: Querying by string ID might need quotes or correct column name matches
        // Re-query with correct column `shipment_id`
    });

    // Correcting the flow nesting:
    const getShipment = "SELECT weight_kg, origin_warehouse FROM SHIPMENTS WHERE shipment_id = ?";
    db.query(getShipment, [shipmentId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ success: false, message: 'Shipment not found' });

        const { weight_kg, origin_warehouse } = results[0];
        const origin = origin_warehouse || 'China'; // Default

        // 2. Get Rate for Origin + Method
        const getRate = "SELECT rate_per_kg FROM SHIPPING_RATES WHERE country_name = ? AND shipping_type = ?";
        db.query(getRate, [origin, method], (err, rateRes) => {
            if (err || rateRes.length === 0) {
                // Fallback or Error
                console.log(`No rate found for ${origin} - ${method}`);
                return res.status(400).json({ success: false, message: `No rate defined for ${origin} via ${method}` });
            }

            const rate = rateRes[0].rate_per_kg;
            const cost = (weight_kg * rate).toFixed(2);

            // 3. Update Shipment
            const updateShipment = "UPDATE SHIPMENTS SET shipping_method = ?, estimated_cost = ?, status = 'Pending' WHERE shipment_id = ?";
            db.query(updateShipment, [method, cost, shipmentId], (err) => {
                if (err) return res.status(500).json({ success: false, message: 'DB Error updating shipment' });
                res.json({ success: true, message: 'Method updated', cost, status: 'Pending' });
            });
        });
    });
});



// Admin API: Update Employee (Email, Password, Warehouse)
app.put('/api/admin/employee/:id', (req, res) => {
    const id = req.params.id;
    const { email, password, assigned_warehouse } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check if email is already taken by another user
    db.query("SELECT user_id FROM USER WHERE email = ? AND user_id != ?", [email, id], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        if (results.length > 0) {
            return res.status(409).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل' });
        }

        let query = "UPDATE USER SET email = ?, assigned_warehouse = ? WHERE user_id = ?";
        let params = [email, assigned_warehouse || null, id]; // Allow null if clearing or not set

        if (password && password.trim() !== "") {
            if (password.length <= 8) {
                return res.status(400).json({ success: false, message: 'كلمة المرور يجب أن تكون أكثر من 8 خانات' });
            }
            query = "UPDATE USER SET email = ?, assigned_warehouse = ?, password_hash = ? WHERE user_id = ?";
            params = [email, assigned_warehouse || null, password, id];
        }

        db.query(query, params, (err, result) => {
            if (err) return res.status(500).json({ success: false, message: 'DB Error' });
            res.json({ success: true, message: 'Updated successfully' });
        });
    });
});

// Admin API: Get Finance Activity (Invoices + Transactions)
app.get('/api/admin/finance/activity', (req, res) => {
    const activity = [];
    let totalRevenue = 0;
    let totalExpenses = 0;

    // 1. Get Invoices (Income)
    db.query(`SELECT i.*, u.full_name FROM INVOICES i JOIN USER u ON i.client_id = u.user_id ORDER BY issue_date DESC LIMIT 50`, (err, invoices) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error Invoices' });

        invoices.forEach(inv => {
            activity.push({
                type: 'Invoice',
                id: inv.invoice_id,
                name: inv.full_name, // Client Name
                ref: 'INV-' + inv.invoice_id,
                amount: inv.total_amount,
                date: inv.issue_date,
                status: inv.payment_status,
                is_income: true
            });
            if (inv.payment_status === 'Paid') totalRevenue += parseFloat(inv.total_amount);
        });

        // 2. Get Transactions (Wallet Deposits/Withdrawals can be income or expense)
        // Assuming 'Deposit' is Income (Client adds money), 'Withdrawal' is Expense (Driver payout etc)
        db.query(`SELECT t.*, u.full_name FROM TRANSACTIONS t JOIN USER u ON t.user_id = u.user_id ORDER BY transaction_date DESC LIMIT 50`, (err, transactions) => {
            if (err) return res.status(500).json({ success: false, message: 'DB Error Transactions' });

            transactions.forEach(tx => {
                const isIncome = tx.type === 'Deposit';
                activity.push({
                    type: 'Transaction',
                    id: tx.transaction_id,
                    name: tx.full_name,
                    ref: 'TRX-' + tx.transaction_id,
                    amount: tx.amount,
                    date: tx.transaction_date,
                    status: 'Completed', // Transactions are usually instant
                    is_income: isIncome,
                    description: tx.description
                });

                if (isIncome) totalRevenue += parseFloat(tx.amount);
                else totalExpenses += parseFloat(tx.amount);
            });

            // 3. Sort Combined List by Date DESC
            activity.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Return limited list (e.g., top 20) and totals
            res.json({
                success: true,
                activity: activity.slice(0, 20),
                totals: { revenue: totalRevenue, expenses: totalExpenses, net: totalRevenue - totalExpenses }
            });
        });
    });
});

// Admin API: Get All Warehouses
app.get('/api/admin/warehouses', (req, res) => {
    db.query("SELECT * FROM LOCATION WHERE type = 'Warehouse' ORDER BY address_id DESC", (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, warehouses: results });
    });
});

// Admin API: Add Warehouse
app.post('/api/admin/warehouse', (req, res) => {
    const { name, city, address } = req.body;
    if (!name || !city || !address) return res.status(400).json({ success: false, message: 'All fields required' });

    const query = "INSERT INTO LOCATION (name, city, address_line_1, type, fk_user_id) VALUES (?, ?, ?, 'Warehouse', NULL)";
    db.query(query, [name, city, address], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, message: 'Warehouse added', id: result.insertId });
    });
});

// Admin API: Update Warehouse
app.put('/api/admin/warehouse/:id', (req, res) => {
    const { name, city, address } = req.body;
    db.query("UPDATE LOCATION SET name=?, city=?, address_line_1=? WHERE address_id=? AND type='Warehouse'",
        [name, city, address, req.params.id], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: 'DB Error' });
            res.json({ success: true, message: 'Updated' });
        });
});

// Admin API: Delete Warehouse
app.delete('/api/admin/warehouse/:id', (req, res) => {
    db.query("DELETE FROM LOCATION WHERE address_id=? AND type='Warehouse'", [req.params.id], (err, result) => {
        if (err) {
            // Check for foreign key constraint (if warehouse has items)
            if (err.code === 'ER_ROW_IS_REFERENCED_2') {
                return res.status(400).json({ success: false, message: 'لا يمكن حذف المستودع لأنه يحتوي على شحنات مرتبطة به' });
            }
            return res.status(500).json({ success: false, message: 'DB Error' });
        }
        res.json({ success: true, message: 'Deleted' });
    });
});

// Admin API: Get System Logs
app.get('/api/admin/logs', (req, res) => {
    const query = `
        SELECT l.*, u.full_name, u.role 
        FROM SYSTEM_LOGS l 
        LEFT JOIN USER u ON l.user_id = u.user_id 
        ORDER BY l.timestamp DESC 
        LIMIT 100
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'DB Error' });
        res.json({ success: true, logs: results });
    });
});

// Admin API: Setup New Country (Rates + Warehouses)
app.post('/api/admin/country-setup', (req, res) => {
    const { countryName, rates, warehouses } = req.body;

    if (!countryName) return res.status(400).json({ success: false, message: 'Country name required' });

    // 1. Add Shipping Rates (Air & Sea)
    const rateQueries = [];
    if (rates.air) {
        rateQueries.push(`INSERT INTO SHIPPING_RATES (country_name, shipping_type, rate_per_kg) VALUES ('${countryName}', 'Air', ${rates.air})`);
    }
    if (rates.sea) {
        rateQueries.push(`INSERT INTO SHIPPING_RATES (country_name, shipping_type, rate_per_kg) VALUES ('${countryName}', 'Sea', ${rates.sea})`);
    }

    // 2. Add Warehouses
    const warehouseQueries = [];
    if (warehouses && warehouses.length > 0) {
        warehouses.forEach(wh => {
            if (wh.name && wh.address) {
                warehouseQueries.push(`INSERT INTO LOCATION (name, country, city, address_line_1, type) VALUES ('${wh.name}', '${countryName}', '${wh.city || countryName}', '${wh.address}', 'Warehouse')`);
            }
        });
    }

    // Execute all queries
    const allQueries = [...rateQueries, ...warehouseQueries];
    if (allQueries.length === 0) return res.json({ success: true, message: 'Nothing to add' });

    const combinedQuery = allQueries.join('; ');
    db.query(combinedQuery, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'DB Error' });
        }

        // Log the action
        const logQuery = `INSERT INTO SYSTEM_LOGS (action, details) VALUES ('Setup Country', 'Added country ${countryName} with ${warehouseQueries.length} warehouses')`;
        db.query(logQuery);

        res.json({ success: true, message: 'Country setup complete' });
    });
});

// Admin API: Get Notifications (Pending Drivers, New Shipments, New Transactions)
app.get('/api/admin/notifications', (req, res) => {
    const notifications = {
        drivers: [],
        shipments: [],
        transactions: []
    };

    // 1. Pending Drivers (All pending)
    db.query("SELECT user_id, full_name, created_at FROM USER WHERE role='Driver' AND kyc_status='Pending' LIMIT 10", (err, drivers) => {
        if (!err) notifications.drivers = drivers;

        // 2. New Shipments (Last 24 hours)
        db.query("SELECT shipment_id, status, creation_date FROM SHIPMENTS WHERE creation_date > NOW() - INTERVAL 24 HOUR ORDER BY creation_date DESC LIMIT 10", (err, shipments) => {
            if (!err) notifications.shipments = shipments;

            // 3. New Transactions (Last 24 hours)
            db.query("SELECT transaction_id, amount, transaction_date FROM TRANSACTIONS WHERE transaction_date > NOW() - INTERVAL 24 HOUR ORDER BY transaction_date DESC LIMIT 10", (err, transactions) => {
                if (!err) notifications.transactions = transactions;

                res.json({ success: true, notifications });
            });
        });
    });
});

// Admin API: Get All Shipments (Live Monitoring)
app.get('/api/admin/all-shipments', (req, res) => {
    const query = `
        SELECT s.*, 
               driver.full_name as driver_name, 
               client.full_name as client_name 
        FROM SHIPMENTS s 
        LEFT JOIN USER driver ON s.driver_id = driver.user_id 
        LEFT JOIN USER client ON s.client_id = client.user_id 
        ORDER BY s.creation_date DESC
    `;
    db.query(query, (err, results) => {
        if (err) {
            console.error('Shipments Error:', err);
            return res.status(500).json({ success: false, message: 'DB Error' });
        }
        res.json({ success: true, shipments: results });
    });
});

// Admin API: Get Dashboard Stats (Counts for Top Boxes)
app.get('/api/admin/dashboard-stats', (req, res) => {
    const stats = {
        pending: 0,
        withDrivers: 0,
        issues: 0
    };

    const query = `
        SELECT 
            SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status IN ('OutForDelivery', 'PickedUp', 'InTransit') THEN 1 ELSE 0 END) as withDrivers,
            SUM(CASE WHEN status IN ('Failed', 'Returned', 'Cancelled') THEN 1 ELSE 0 END) as issues
        FROM SHIPMENTS
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Stats Error:', err);
            return res.status(500).json({ success: false, message: 'DB Error' });
        }

        if (results.length > 0) {
            stats.pending = results[0].pending || 0;
            stats.withDrivers = results[0].withDrivers || 0;
            stats.issues = results[0].issues || 0;
        }

        res.json({ success: true, stats });
    });
});

// Admin API: Freeze/Unfreeze Driver
app.post('/api/admin/driver/freeze', (req, res) => {
    const { userId, action } = req.body; // action: 'freeze' or 'unfreeze'
    const isFrozen = action === 'freeze' ? 1 : 0;

    // In a real app we might want to also force-logout the user or cancel assignments
    db.query('UPDATE USER SET is_frozen = ? WHERE user_id = ?', [isFrozen, userId], (err, result) => {
        if (err) {
            console.error('Freeze Error:', err);
            return res.status(500).json({ success: false, message: 'DB Error' });
        }
        res.json({ success: true, message: `تم ${action === 'freeze' ? 'تجميد' : 'تنشيط'} حساب السائق بنجاح` });
    });
});

// Client API: Get Client Shipments
app.get('/api/client/shipments', (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).json({ success: false, message: 'Client ID required' });

    const query = 'SELECT * FROM SHIPMENTS WHERE client_id = ? ORDER BY creation_date DESC';
    db.query(query, [clientId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        res.json({ success: true, shipments: results });
    });
});

// Client API: Get Single Shipment Details
app.get('/api/shipments/:id', (req, res) => {
    const shipmentId = req.params.id;
    if (!shipmentId) return res.status(400).json({ success: false, message: 'Shipment ID required' });

    const query = 'SELECT * FROM SHIPMENTS WHERE shipment_id = ?';
    db.query(query, [shipmentId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'Shipment not found' });
        res.json({ success: true, shipment: results[0] });
    });
});

// Client API: Create New Shipment
app.post('/api/shipments', (req, res) => {
    const {
        client_id,
        receiver_address_id, // For now we might just use raw text if address ID isn't ready
        shipping_method, // 'Air', 'Sea', 'Land'
        content_description,
        weight_kg,
        dimensions,
        type, // 'Package', 'Docs'
        payment_responsibility, // 'prepaid', 'cod'
        estimated_cost,
        receiver_name,
        receiver_city,
        receiver_phone,
        receiver_address_detail
    } = req.body;

    // Generate a random ID (e.g., TRK-123456)
    const shipmentId = 'TRK-' + Math.floor(100000 + Math.random() * 900000);

    // Note: In a real app we would create a proper address record first if receiver_address_id is null
    // For this demo, we'll assume the client sends a valid address ID OR we default to a dummy one if not provided,
    // or arguably we should insert into LOCATION table first.
    // To keep it simple for now, let's assume client_id matches a user, and we fake the address ID or use a known one.
    // Ideally, the frontend should create address first. 
    // BUT, let's just use a hardcoded address ID '1' or '2' if not provided for simplicity in this demo,
    // unless we strictly want to implement address creation too.

    // Better approach: We'll require receiver_address_id in the payload. 
    // The frontend should ideally pick an address. 

    // Fallback: If no address ID, use 1 (Assuming 1 exists from seed data)
    const addrId = receiver_address_id || 1;

    // Status is Pending by default
    const status = 'Pending';

    const query = `
        INSERT INTO SHIPMENTS 
        (shipment_id, client_id, receiver_address_id, shipping_method, content_description, weight_kg, dimensions, status, estimated_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Calculate Cost Server-Side
    let costQuery = "SELECT rate_per_kg FROM SHIPPING_RATES WHERE country_name = ? AND shipping_type = ?";
    let costParams = [req.body.country_name, shipping_method];
    let isLand = shipping_method === 'Land';

    // If Land, we skip DB rate lookup for now and use fixed price, OR we could have a 'Libya' rate in DB.
    // User requested "Internal is fixed".
    if (isLand) {
        // Mock query that returns nothing or we just bypass
        costQuery = "SELECT 1";
        // We'll handle logic below
    }

    db.query(costQuery, costParams, (err, rates) => {
        let finalCost = 0;

        if (isLand) {
            finalCost = 25.00; // Fixed Internal Price
        } else if (!err && rates && rates.length > 0) {
            const rate = rates[0].rate_per_kg;
            finalCost = (parseFloat(weight_kg) || 1) * rate;
            if (finalCost < 10) finalCost = 10;
        } else {
            // Fallback if no rate found for country (e.g. unknown country)
            console.log("No rate found for", req.body.country_name, shipping_method);
            finalCost = 0; // Or error out?
        }

        db.query(query, [shipmentId, client_id, addrId, shipping_method, content_description, weight_kg, dimensions, status, finalCost], (err, result) => {
            if (err) {
                console.error('Create Shipment Error:', err);
                return res.status(500).json({ success: false, message: 'DB Error creating shipment' });
            }
            res.json({ success: true, message: 'Shipment created successfully', shipmentId });
            res.json({ success: true, message: 'Shipment created successfully', shipmentId });
        });
    });
});

// Client API: Get Warehouses
app.get('/api/warehouses', (req, res) => {
    const query = "SELECT * FROM LOCATION WHERE type = 'Warehouse'";
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        res.json({ success: true, warehouses: results });
    });
});

// Client API: Get Client Addresses
app.get('/api/client/addresses', (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).json({ success: false, message: 'Client ID required' });

    const query = "SELECT * FROM LOCATION WHERE type = 'Customer_Delivery' AND fk_user_id = ?";
    db.query(query, [clientId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        res.json({ success: true, addresses: results });
    });
});

// Client API: Add New Address
app.post('/api/client/addresses', (req, res) => {
    const { clientId, name, city, phone, address_line_1, details } = req.body;

    if (!clientId || !address_line_1 || !city) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Combine address_line_1 and details if needed, or store details separately if DB supports it.
    // Our schema has address_line_1, city, zip_code. Let's append details to address_line_1 for simplicity 
    // or assume address_line_1 holds the main info.
    // NOTE: The LOCATION table has 'name' column which we can use for the label (Home, Work).

    const query = `INSERT INTO LOCATION (fk_user_id, name, city, address_line_1, type) VALUES (?, ?, ?, ?, 'Customer_Delivery')`;

    // We might want to store phone somewhere? The schema doesn't have a phone col in LOCATION.
    // We can append it to the address string for now: "Street... (Phone: ...)"
    const finalAddress = `${address_line_1} ${details ? '- ' + details : ''} (Tel: ${phone})`;

    db.query(query, [clientId, name, city, finalAddress], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, message: 'Address added successfully' });
    });
});

// Driver API: Get Assigned Tasks
app.get('/api/driver/tasks', (req, res) => {
    const driverId = req.query.driverId;
    if (!driverId) return res.status(400).json({ success: false, message: 'Driver ID required' });

    // Join with USER to get Client Name, and LOCATION to get Address
    const query = `
        SELECT s.*, u.full_name as client_name, u.phone_number as client_phone,
               l.address_line_1 as destination_address, l.city as destination_city
        FROM SHIPMENTS s
        LEFT JOIN USER u ON s.client_id = u.user_id
        LEFT JOIN LOCATION l ON s.receiver_address_id = l.address_id
        WHERE s.driver_id = ? 
        AND s.status IN ('OutForDelivery', 'Assigned', 'InTransit')
    `;

    db.query(query, [driverId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        res.json({ success: true, tasks: results });
    });
});

// Driver API: Get Financial Custody
app.get('/api/driver/custody', (req, res) => {
    const driverId = req.query.driverId;
    if (!driverId) return res.status(400).json({ success: false, message: 'Driver ID required' });

    // Get 'Delivered' shipments which imply cash collection
    // We join with USER to get client name
    const query = `
        SELECT s.shipment_id, s.estimated_cost, s.status, u.full_name as client_name
        FROM SHIPMENTS s
        LEFT JOIN USER u ON s.client_id = u.user_id
        WHERE s.driver_id = ? 
        AND s.status = 'Delivered'
        ORDER BY s.creation_date DESC
    `;

    db.query(query, [driverId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });

        // Calculate Total Collected (Sum of estimated_cost of Delivered shipments)
        const totalCollected = results.reduce((sum, item) => sum + (parseFloat(item.estimated_cost) || 0), 0);

        // Get Total Handovers
        db.query("SELECT SUM(amount) as handed_over FROM TRANSACTIONS WHERE user_id = ? AND type = 'Custody_Handover'", [driverId], (err, txResults) => {
            const totalHandedOver = txResults[0]?.handed_over || 0;
            const netCustody = totalCollected - totalHandedOver;

            res.json({
                success: true,
                total_custody: netCustody.toFixed(2),
                history: results
            });
        });
    });
});

// Driver API: Update Availability Status
app.post('/api/driver/status', (req, res) => {
    const { driverId, status } = req.body;
    if (!driverId || !status) return res.status(400).json({ success: false, message: 'Missing fields' });

    // Validate status enum
    const validStatuses = ['Available', 'Busy', 'Offline'];
    // Map basic boolean/toggle to these or accept them directly
    // If the frontend sends 'true'/'false', assume Available/Offline
    let dbStatus = status;
    if (status === true || status === 'true') dbStatus = 'Available';
    if (status === false || status === 'false') dbStatus = 'Offline';

    // Only update if it's a valid DB enum value (or we just force it if we trust frontend)
    // For now, let's stick to the mapped values or provided valid string

    const query = "UPDATE DRIVER_DETAILS SET availability_status = ? WHERE fk_user_id = ?";
    db.query(query, [dbStatus, driverId], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, status: dbStatus });
    });
});

// Admin API: Distribute "Land" Shipments
app.post('/api/admin/distribute', (req, res) => {
    // 1. Get all Pending LAND shipments
    const getShipmentsQuery = "SELECT shipment_id FROM SHIPMENTS WHERE status = 'Pending' AND shipping_method = 'Land'";

    db.query(getShipmentsQuery, (err, shipments) => {
        if (err) return res.status(500).json({ success: false, message: 'Error fetching shipments' });

        if (shipments.length === 0) {
            return res.json({ success: false, message: 'لا توجد شحنات برية معلقة للتوزيع' });
        }

        // 2. Get all Available Drivers
        const getDriversQuery = `
            SELECT u.user_id 
            FROM USER u
            JOIN DRIVER_DETAILS d ON u.user_id = d.fk_user_id
            WHERE u.role = 'Driver' 
            AND u.kyc_status = 'Active' 
            AND u.is_frozen = 0 
            AND d.availability_status = 'Available'
        `;

        db.query(getDriversQuery, (err, drivers) => {
            if (err) return res.status(500).json({ success: false, message: 'Error fetching drivers' });

            if (drivers.length === 0) {
                return res.json({ success: false, message: 'لا يوجد سائقين متاحين حالياً' });
            }

            // 3. Distribute (Round Robin / Simple Modulo)
            let updates = 0;
            const totalShipments = shipments.length;

            shipments.forEach((shipment, index) => {
                const driver = drivers[index % drivers.length];
                // Update Shipment
                db.query("UPDATE SHIPMENTS SET driver_id = ?, status = 'OutForDelivery' WHERE shipment_id = ?", [driver.user_id, shipment.shipment_id]);

                // Notify Driver (via Socket)
                if (io) io.to('driver_' + driver.user_id).emit('new_shipment', { shipmentId: shipment.shipment_id });

                updates++;
            });

            res.json({ success: true, message: `تم توزيع ${updates} شحنة برية على ${drivers.length} سائق بنجاح ✅` });
        });
    });
});

server.listen(port, () => {
    console.log(`🚀 Server (Socket.io) running at http://localhost:${port}`);
});
