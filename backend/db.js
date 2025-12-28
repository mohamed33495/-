const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'mohamed2002', // User provided password
    database: 'CargoAppDB', // Matches the SQL file content
    multipleStatements: true // Allow multiple queries (needed for Country Setup)
});

connection.connect((err) => {
    if (err) {
        console.error('❌ Database connection failed: ' + err.message);
        return;
    }
    console.log('✅ Connected to MySQL database (aircargodata).');
});

module.exports = connection;
