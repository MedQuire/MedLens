# start-tunnel.ps1
# This script manages EVERYTHING: Backend Server, Fresh Tunnels, and App Startup.
# Refactored for absolute reliability (Stateless Mode + Network Hardening + Expo Go Fix).

# 0. Helper Functions
function Get-SafeContent($path) {
    if (-not (Test-Path $path)) { return "" }
    try {
        $file = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
        $reader = New-Object System.IO.StreamReader($file)
        $text = $reader.ReadToEnd()
        $reader.Close()
        $file.Close()
        return $text
    } catch {
        return ""
    }
}

function Get-UrlFromLog($filter) {
    # Check log files matching the filter
    $logs = Get-ChildItem -Path "." -Filter $filter | Sort-Object LastWriteTime -Descending
    foreach ($log in $logs) {
        $content = Get-SafeContent $log.FullName
        if ($content -match "(https://[a-zA-Z0-9-]+\.trycloudflare\.com)") { return $matches[1] }
        if ($content -match "(https://[a-zA-Z0-9-]+\.ngrok-free\.app)") { return $matches[1] }
        if ($content -match "(https://[a-zA-Z0-9-]+\.loca\.lt)") { return $matches[1] }
    }
    return $null
}

function Test-PortActive {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function Stop-ProcessOnPort {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "Force killing stale process on port $Port (PID: $($conn.OwningProcess))..." -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

# 1. HARD RESET & NETWORK HARDENING
Write-Host "--- MedQuire Tunnel System (Expo Go Optimized) ---" -ForegroundColor Magenta
Write-Host "Hardening network settings and cleaning ports..." -ForegroundColor Cyan

# Fix for Node 18+ / Node 24 experimental network issues
$env:NODE_OPTIONS = "--dns-result-order=ipv4first --max-old-space-size=4096"
$env:EXPO_SKIP_DEPENDENCY_VALIDATION = "1"
$env:EXPO_NO_TELEMETRY = "1"

# Kill all tunnel processes and existing dev servers
Get-Process "cloudflared*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*localtunnel*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Stop-ProcessOnPort 3001
Stop-ProcessOnPort 8081
Stop-ProcessOnPort 8082

# Wipe stale logs
@("backend.log", "frontend.log", "qrcode.png", "backend*.log", "frontend*.log") | ForEach-Object {
    if (Test-Path $_) { Remove-Item $_ -Force -ErrorAction SilentlyContinue }
}
Write-Host "Waiting for handles to release..." -ForegroundColor Gray
Start-Sleep -Seconds 3

$maxWait = 120

# 2. Handle Backend API (Port 3001)
Write-Host "`n[1/4] Starting Backend API..." -ForegroundColor Cyan
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory "../api" -NoNewWindow -PassThru -RedirectStandardOutput "../api/server_out.log" -RedirectStandardError "../api/server_err.log"

$apiReady = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-PortActive -Port 3001) { $apiReady = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $apiReady) { Write-Host "Error: Backend failed to start." -ForegroundColor Red; exit 1 }
Write-Host "Backend API is LIVE!" -ForegroundColor Green

# 3. Handle Backend Tunnel (Port 3001)
Write-Host "`n[2/4] Starting Fresh Backend Tunnel (Cloudflare)..." -ForegroundColor Cyan
$backendLog = "backend_$(Get-Date -Format 'HHmmss').log"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx cloudflared tunnel --url http://127.0.0.1:3001 --no-autoupdate --metrics 127.0.0.1:0 > $backendLog 2>&1" -NoNewWindow -PassThru

$backendUrl = $null
$counter = 0
while ($null -eq $backendUrl -and $counter -lt $maxWait) {
    # Check if process died
    $proc = Get-Process "cloudflared*" -ErrorAction SilentlyContinue 
    if ($null -eq $proc -and $counter -gt 15 -and $counter -lt ($maxWait - 10)) {
        Write-Host "Backend tunnel process died, retrying..." -ForegroundColor Yellow
        $backendLog = "backend_retry_$(Get-Date -Format 'HHmmss').log"
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c .\node_modules\.bin\cloudflared.cmd tunnel --url http://127.0.0.1:3001 --no-autoupdate --protocol http2 --metrics 127.0.0.1:0 > $backendLog 2>&1" -NoNewWindow -PassThru
        Start-Sleep -Seconds 5
    }

    Start-Sleep -Seconds 4
    $backendUrl = Get-UrlFromLog "backend*.log"
    $counter += 4
}

if ($null -eq $backendUrl) { Write-Host "Error: Could not retrieve Backend URL." -ForegroundColor Red; exit 1 }
Write-Host "Backend Tunnel: $backendUrl" -ForegroundColor Green

# 4. Sync .env — DISABLED: tunnel URL would overwrite production Railway URL
# Write-Host "`n[Syncing .env]..." -ForegroundColor Gray
# if (Test-Path ".env") {
#     $envContent = Get-Content ".env"
#     $newEnvContent = $envContent -replace "EXPO_PUBLIC_API_BASE_URL=.*", "EXPO_PUBLIC_API_BASE_URL=$backendUrl"
#     $newEnvContent | Set-Content ".env" -Encoding Utf8
#     Write-Host "Successfully synced .env!" -ForegroundColor Green
# }
Write-Host "[Skipped .env sync — keeping EXPO_PUBLIC_API_BASE_URL unchanged]" -ForegroundColor Yellow

# 5. Handle Frontend Tunnel (Port 8081)
Write-Host "`n[3/4] Starting Fresh Frontend Tunnel (Cloudflare)..." -ForegroundColor Cyan
$frontendLog = "frontend_$(Get-Date -Format 'HHmmss').log"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx cloudflared tunnel --url http://127.0.0.1:8081 --no-autoupdate --metrics 127.0.0.1:0 > $frontendLog 2>&1" -NoNewWindow -PassThru

$frontendUrl = $null
$counter = 0
while ($null -eq $frontendUrl -and $counter -lt $maxWait) {
    # Simple wait for propagation
    Start-Sleep -Seconds 5
    $frontendUrl = Get-UrlFromLog "frontend*.log"
    
    # If it died, retry once
    if ($null -eq $frontendUrl -and $counter -gt 15 -and $null -eq (Get-Process "cloudflared*" -ErrorAction SilentlyContinue)) {
         $frontendLog = "frontend_retry_$(Get-Date -Format 'HHmmss').log"
         Start-Process -FilePath "cmd.exe" -ArgumentList "/c .\node_modules\.bin\cloudflared.cmd tunnel --url http://127.0.0.1:8081 --no-autoupdate --protocol http2 --metrics 127.0.0.1:0 > $frontendLog 2>&1" -NoNewWindow -PassThru
    }
    
    $counter += 5
}

if ($null -eq $frontendUrl) { Write-Host "Error: Could not retrieve Frontend URL." -ForegroundColor Red; exit 1 }
Write-Host "Frontend Tunnel: $frontendUrl" -ForegroundColor Green

# Wait for tunnel propagation (Fixes the 'QR works but app doesn't open' issue)
Write-Host "Waiting for tunnel propagation..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# 6. Launch Expo
Write-Host "`n[4/4] Launching Expo Bundler..." -ForegroundColor Cyan
$env:EXPO_PACKAGER_PROXY_URL = $frontendUrl

# Build the correct Expo Go URL (Standard exp:// for Expo Go)
$cleanUrl = $frontendUrl -replace "^https?://", ""
$qrUrl = "exp://$cleanUrl"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host " SCAN THIS QR CODE WITH YOUR PHONE CAMERA" -ForegroundColor Yellow
Write-Host " It will open in EXPO GO automatically" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""

# Generate QR code in terminal
node -e "const qr = require('qrcode'); qr.toString('$qrUrl', { type: 'terminal', small: true }, (e, s) => { if (!e) console.log(s); else console.error(e); });"

# Generate File as backup
node -e "const qr = require('qrcode'); qr.toFile('qrcode.png', '$qrUrl', { width: 400, margin: 2 }, (e) => { if (!e) { require('child_process').exec('start qrcode.png'); } });"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host " If QR doesn't work, open this URL on your phone:" -ForegroundColor Yellow
Write-Host " $frontendUrl" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Magenta
Write-Host ""

# Start Metro Bundler in the current terminal
# We must use --offline because Node 24's fetch is breaking Expo's call-home components
npx.cmd expo start --offline --clear
