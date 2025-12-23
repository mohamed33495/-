const nodemailer = require('nodemailer');

// In-memory store for tokens (Production: Use Redis or DB)
const resetTokens = {};

// Transporter (Mock for now, prints to console)
// To use real Gmail: service: 'gmail', auth: { user: '...', pass: '...' }
const transporter = nodemailer.createTransport({
    jsonTransport: true
});

module.exports = {
    // Generate and store token
    createToken: (email) => {
        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        resetTokens[token] = { email, expires: Date.now() + 3600000 }; // 1 hour
        return token;
    },

    // Verify token
    verifyToken: (token) => {
        const data = resetTokens[token];
        if (!data || data.expires < Date.now()) return null;
        return data.email;
    },

    // Delete token
    consumeToken: (token) => {
        delete resetTokens[token];
    },

    // Send Email (Mock)
    sendResetEmail: async (email, token) => {
        const link = `http://localhost:3000/reset-password.html?token=${token}`;

        console.log('---------------------------------------------------');
        console.log(`📧 MOCK EMAIL TO: ${email}`);
        console.log(`🔗 LINK: ${link}`);
        console.log('---------------------------------------------------');

        // In a real app, you would use transporter.sendMail(...)
        return true;
    }
};
