# ============================================================
# start-all.ps1 — Jalankan semua service sekaligus
# Usage: .\start-all.ps1
# ============================================================

Write-Host "Starting Redis..." -ForegroundColor Cyan
$redis = Get-Process -Name "redis-server" -ErrorAction SilentlyContinue
if (-not $redis) {
  Start-Process -FilePath "C:\laragon\bin\redis\redis-x64-5.0.14.1\redis-server.exe" -WindowStyle Hidden
  Start-Sleep -Seconds 1
  Write-Host "  Redis started" -ForegroundColor Green
} else {
  Write-Host "  Redis already running" -ForegroundColor Yellow
}

Write-Host "Starting Gateway via PM2..." -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\apps\gateway"
npx pm2 start ecosystem.config.cjs --update-env
npx pm2 save
Set-Location -Path $PSScriptRoot

Write-Host "Starting Next.js web..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; npm run dev:web" -WindowStyle Normal

Write-Host ""
Write-Host "All services started!" -ForegroundColor Green
Write-Host "  Web    -> http://localhost:3000" -ForegroundColor White
Write-Host "  Gateway -> http://localhost:3001 (PM2)" -ForegroundColor White
Write-Host "  Redis  -> localhost:6379" -ForegroundColor White
Write-Host ""
Write-Host "PM2 commands:" -ForegroundColor Yellow
Write-Host "  npx pm2 status        # lihat status gateway"
Write-Host "  npx pm2 logs wa-gateway  # lihat logs gateway"
Write-Host "  npx pm2 restart wa-gateway  # restart gateway"
