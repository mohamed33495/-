@echo off
echo Starting Shehnty App Server...
cd backend
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)
echo initiating server...
node server.js
pause
