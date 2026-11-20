$backendPath = Join-Path $PSScriptRoot "sscs_node"
$frontendPath = Join-Path $PSScriptRoot "sscs_frontend"

if (-not (Test-Path (Join-Path $backendPath "node_modules"))) {
    throw "Backend dependencies are missing. Run 'npm install' in $backendPath first."
}

if (-not (Test-Path (Join-Path $frontendPath "node_modules"))) {
    throw "Frontend dependencies are missing. Run 'npm install' in $frontendPath first."
}

if (-not (Test-Path (Join-Path $backendPath ".env"))) {
    throw "Backend configuration is missing. Create $backendPath\.env from .env.example first."
}

Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $backendPath `
    -ArgumentList "-NoExit", "-Command", "npm run dev"

Start-Process -FilePath "powershell.exe" `
    -WorkingDirectory $frontendPath `
    -ArgumentList "-NoExit", "-Command", "npm run dev"

Write-Host "Backend and frontend are starting in separate PowerShell windows."
Write-Host "Open http://localhost:5173 when Vite is ready. Close each window to stop its server."
