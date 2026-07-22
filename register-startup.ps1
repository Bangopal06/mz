# register-startup.ps1
# Jalankan script ini SEKALI sebagai Administrator untuk register startup task
# Caranya: klik kanan file ini -> "Run with PowerShell" -> pilih Yes saat minta admin

param()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $scriptDir "start-services.bat"

$action = New-ScheduledTaskAction `
  -Execute "cmd.exe" `
  -Argument "/c `"$batPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Highest

try {
  Register-ScheduledTask `
    -TaskName "WA-Broadcast-CRM-Startup" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force

  Write-Host ""
  Write-Host "SUCCESS! Startup task registered." -ForegroundColor Green
  Write-Host "Gateway + Redis will start automatically when you log in." -ForegroundColor Green
  Write-Host ""
  Write-Host "To test: run 'start-services.bat' manually now." -ForegroundColor Yellow
} catch {
  Write-Host "FAILED: $_" -ForegroundColor Red
  Write-Host ""
  Write-Host "Manual steps:" -ForegroundColor Yellow
  Write-Host "1. Open Task Scheduler (Win+R -> taskschd.msc)"
  Write-Host "2. Create Basic Task -> At log on"
  Write-Host "3. Program: cmd.exe"
  Write-Host "4. Arguments: /c `"$batPath`""
  Write-Host "5. Check 'Run with highest privileges'"
}

Read-Host "Press Enter to close"
