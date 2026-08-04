# dev.ps1 — Start gateway + web dev servers
# Usage: .\dev.ps1

Write-Host "Stopping existing Node processes..." -ForegroundColor Yellow
taskkill /F /IM node.exe 2>$null
Start-Sleep -Seconds 1

Write-Host "Starting Gateway (port 3001)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\apps\gateway'; npm run dev"

Write-Host "Waiting for gateway to bind port 3001..." -ForegroundColor Cyan
Start-Sleep -Seconds 4

Write-Host "Starting Next.js Web (port 3000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\apps\web'; npm run dev -- -p 3000"

Write-Host "Both servers starting. Gateway: http://localhost:3001  Web: http://localhost:3000" -ForegroundColor Green
