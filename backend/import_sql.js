const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'mohamed2002',
    multipleStatements: true // Important for running the dump
});

connection.connect((err) => {
    if (err) {
        console.error('❌ Connection Failed:', err.message);
        return;
    }
    console.log('✅ Connected to MySQL.');

    // Read SQL File
    const sqlPath = path.join(__dirname, 'CargoAppDB.sql');
    fs.readFile(sqlPath, 'utf8', (err, data) => {
        if (err) {
            console.error('❌ Error reading SQL file:', err.message);
            return;
        }

        console.log('📂 Importing SQL file...');
        connection.query(data, (err, results) => {
            if (err) {
                console.error('❌ Import Failed:', err.message);
            } else {
                console.log('✅ Database Imported Successfully!');
                console.log('✅ Created CargoAppDB and Tables.');
            }
            connection.end();
        });
    });
});
