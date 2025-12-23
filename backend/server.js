const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Login Route
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT * FROM USER WHERE email = ? AND password_hash = ?';
    db.query(query, [email, password], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });

        if (results.length > 0) {
            const user = results[0];
            const role = user.role.toLowerCase();

            // Check KYC Status for Drivers
            if (role === 'driver' && user.kyc_status !== 'Active') {
                return res.status(403).json({ success: false, message: 'حسابك لا يزال قيد المراجعة. يرجى الانتظار حتى يتم قبول طلبك.' });
            }

            res.json({ success: true, user: { email: user.email, role: role } });
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

        const suite_id = 'SH-' + Math.floor(100000 + Math.random() * 900000);

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
                const license = generatedLicense || ('LIC-' + userId);
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

app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
});
