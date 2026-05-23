# Paths
$AppSettingsExample = "backend/src/Carmasters.Http.Api/appsettings.Secrets.json.example"
$AppSettingsTarget  = "backend/src/Carmasters.Http.Api/appsettings.Secrets.json"
$EnvExample         = "frontend/.env.example"
$EnvTarget          = "frontend/.env"

# Create files from example
Copy-Item $AppSettingsExample $AppSettingsTarget -Force
Copy-Item $EnvExample $EnvTarget -Force

# Generate secrets
$JwtSecret = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")  # 64-char hex
$ConsumerSecret = [Convert]::ToBase64String((1..32 | ForEach-Object {Get-Random -Minimum 0 -Maximum 256}))
$SessionSecret  = [Convert]::ToBase64String((1..32 | ForEach-Object {Get-Random -Minimum 0 -Maximum 256}))

# Update appsettings.Secrets.json
(Get-Content $AppSettingsTarget) -replace '"Secret":\s*".*?"',    "`"Secret`": `"$JwtSecret`"" |
                               ForEach-Object {$_ -replace '"ConsumerSecret":\s*".*?"', "`"ConsumerSecret`": `"$ConsumerSecret`""} |
    Set-Content $AppSettingsTarget

# Update .env
(Get-Content $EnvTarget) -replace '^SERVER_SECRET=.*', "SERVER_SECRET=$ConsumerSecret" |
                        ForEach-Object {$_ -replace '^SESSION_SECRET=.*', "SESSION_SECRET=$SessionSecret"} |
                        ForEach-Object {$_ -replace '^API_URL=.*', 'API_URL=http://localhost:15567'} |
                        ForEach-Object {$_ -replace '^NEXT_PUBLIC_API_URL=.*', 'NEXT_PUBLIC_API_URL=http://localhost:15567'} |
    Set-Content $EnvTarget

Write-Host "Secrets generated and applied to:"
Write-Host "  - $AppSettingsTarget"
Write-Host "  - $EnvTarget"
