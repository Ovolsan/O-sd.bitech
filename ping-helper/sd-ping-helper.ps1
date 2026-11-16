<#
.SYNOPSIS
    Локальний помічник пінгу для скрипта «О sd.bitech».

.DESCRIPTION
    Браузер не вміє надсилати ICMP, тому скрипт у Tampermonkey звертається до цього помічника.
    Помічник слухає лише 127.0.0.1 і виконує справжній пінг (System.Net.NetworkInformation.Ping).

      GET /status                                   — перевірка, що помічник працює
      GET /ping?ip=10.0.0.1,10.0.0.2&timeout=1000&count=2
                                                    — пінг до 256 адрес IPv4 одночасно

    Запит без заголовка X-Ovolya-Ping або з чужого сайту відхиляється, тож інші сторінки
    не можуть використати помічник.

.PARAMETER Port
    Порт на 127.0.0.1. Скрипт звертається до 47123, тому змінювати його не потрібно.

.PARAMETER InstallAutostart
    Додати прихований запуск помічника в автозавантаження Windows (поточний користувач),
    одразу запустити його у фоні й вийти.

.PARAMETER RemoveAutostart
    Прибрати помічник з автозавантаження і вийти (запущений помічник продовжує працювати).

.PARAMETER Stop
    Зупинити запущений помічник, зокрема прихований з автозапуску, і вийти.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File sd-ping-helper.ps1
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File sd-ping-helper.ps1 -InstallAutostart
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File sd-ping-helper.ps1 -Stop
#>
param(
    [int]$Port = 47123,
    [switch]$InstallAutostart,
    [switch]$RemoveAutostart,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$Version = '1'
$AllowedOrigins = @('https://sd.bitech.com.ua')
$MaxAddresses = 256
$Ipv4Pattern = '^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$'
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'sd.bitech ping helper.lnk'
$HiddenArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Port $Port"

# Чи відповідає на порту саме цей помічник (а не інша програма).
function Test-HelperRunning {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/status" -Headers @{ 'X-Ovolya-Ping' = '1' } -TimeoutSec 3
        return (ConvertFrom-Json $response.Content).name -eq 'sd-ping-helper'
    } catch {
        return $false
    }
}

# Процес, що слухає порт; для зупинки береться лише процес саме цього помічника.
function Get-PortOwner {
    $connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
}

if ($Stop) {
    $owner = Get-PortOwner
    if (-not $owner) {
        Write-Host "Помічник пінгу не запущено (порт $Port вільний)."
    } elseif ($owner.CommandLine -like '*sd-ping-helper.ps1*') {
        Stop-Process -Id $owner.ProcessId -Force
        Write-Host "Помічник пінгу зупинено (процес $($owner.ProcessId))."
    } else {
        Write-Host "Порт $Port зайнятий іншою програмою ($($owner.Name), процес $($owner.ProcessId)) — її не зупинено." -ForegroundColor Yellow
        exit 1
    }
    return
}

if ($InstallAutostart -or $RemoveAutostart) {
    if (Test-Path -LiteralPath $ShortcutPath) { Remove-Item -LiteralPath $ShortcutPath -Force }
    if ($InstallAutostart) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($ShortcutPath)
        $shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
        $shortcut.Arguments = $HiddenArguments
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.WindowStyle = 7
        $shortcut.Description = 'sd.bitech ping helper'
        $shortcut.Save()
        Write-Host "Автозапуск додано: $ShortcutPath"
        if (Test-HelperRunning) {
            Write-Host 'Помічник уже працює у фоні.'
        } else {
            Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $HiddenArguments -WindowStyle Hidden
            Write-Host 'Помічник запущено у фоні; далі він стартуватиме разом із Windows.'
        }
    } else {
        Write-Host 'Автозапуск прибрано. Зупинити запущений помічник: sd-ping-helper.cmd -Stop'
    }
    return
}

function Get-QueryValues([string]$Query) {
    $values = @{}
    foreach ($pair in $Query.TrimStart('?').Split('&')) {
        if (-not $pair) { continue }
        $parts = $pair.Split('=', 2)
        $name = [Uri]::UnescapeDataString($parts[0].Replace('+', ' '))
        $value = if ($parts.Count -gt 1) { [Uri]::UnescapeDataString($parts[1].Replace('+', ' ')) } else { '' }
        $values[$name] = $value
    }
    return $values
}

function Get-ClampedInt([string]$Value, [int]$Default, [int]$Min, [int]$Max) {
    $number = 0
    if (-not [int]::TryParse($Value, [ref]$number)) { return $Default }
    return [Math]::Min([Math]::Max($number, $Min), $Max)
}

# Усі адреси пінгуються паралельно; недоступні отримують ще одну спробу (до $Count).
function Invoke-Ping([string[]]$Addresses, [int]$Timeout, [int]$Count) {
    $results = [ordered]@{}
    foreach ($ip in $Addresses) {
        $results[$ip] = [ordered]@{ ip = $ip; alive = $false; time = $null; status = 'TimedOut' }
    }
    $pending = @($Addresses)
    for ($attempt = 0; $attempt -lt $Count -and $pending.Count -gt 0; $attempt++) {
        $jobs = @(foreach ($ip in $pending) {
            $ping = New-Object System.Net.NetworkInformation.Ping
            [pscustomobject]@{ Ip = $ip; Ping = $ping; Task = $ping.SendPingAsync($ip, $Timeout) }
        })
        try {
            [void][System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($jobs | ForEach-Object { $_.Task }), $Timeout + 2000)
        } catch {
            # Помилки окремих адрес розбираються нижче.
        }
        $next = @()
        foreach ($job in $jobs) {
            $entry = $results[$job.Ip]
            if ($job.Task.Status -eq [System.Threading.Tasks.TaskStatus]::RanToCompletion) {
                $reply = $job.Task.Result
                if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                    $entry.alive = $true
                    $entry.time = [int]$reply.RoundtripTime
                    $entry.status = 'Success'
                } else {
                    $entry.status = [string]$reply.Status
                    $next += $job.Ip
                }
                $job.Ping.Dispose()
            } else {
                $entry.status = if ($job.Task.IsFaulted) { 'Error' } else { 'TimedOut' }
                $next += $job.Ip
            }
        }
        $pending = $next
    }
    return , @($results.Values)
}

function Send-Response($Stream, [int]$Status, [string]$Reason, [hashtable]$Headers, [string]$Body) {
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("HTTP/1.1 $Status $Reason")
    foreach ($key in $Headers.Keys) { $lines.Add("${key}: $($Headers[$key])") }
    $lines.Add("Content-Length: $($bodyBytes.Length)")
    $lines.Add('Cache-Control: no-store')
    $lines.Add('Connection: close')
    $head = [System.Text.Encoding]::ASCII.GetBytes(($lines -join "`r`n") + "`r`n`r`n")
    $Stream.Write($head, 0, $head.Length)
    if ($bodyBytes.Length -gt 0) { $Stream.Write($bodyBytes, 0, $bodyBytes.Length) }
    $Stream.Flush()
}

function Send-Json($Stream, [int]$Status, [string]$Reason, [hashtable]$Headers, $Data) {
    $Headers['Content-Type'] = 'application/json; charset=utf-8'
    Send-Response $Stream $Status $Reason $Headers (ConvertTo-Json -InputObject $Data -Depth 5 -Compress)
}

function Invoke-Client([System.Net.Sockets.TcpClient]$Client) {
    $Client.ReceiveTimeout = 3000
    $Client.SendTimeout = 3000
    $stream = $Client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { return }
    $headers = @{}
    for ($index = 0; $index -lt 100; $index++) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($line)) { break }
        $separator = $line.IndexOf(':')
        if ($separator -gt 0) { $headers[$line.Substring(0, $separator).Trim().ToLowerInvariant()] = $line.Substring($separator + 1).Trim() }
    }
    $parts = $requestLine.Split(' ')
    if ($parts.Count -lt 2) { return }
    $method = $parts[0].ToUpperInvariant()
    $target = $parts[1]

    # Сторінки інших сайтів не отримують доступу; менеджер скриптів надсилає запит без Origin
    # або з адресою розширення.
    $origin = $headers['origin']
    $originAllowed = (-not $origin) -or ($AllowedOrigins -contains $origin) -or ($origin -match '^(chrome|moz|safari-web)-extension://')
    $responseHeaders = @{}
    if ($origin -and $originAllowed) {
        $responseHeaders['Access-Control-Allow-Origin'] = $origin
        $responseHeaders['Vary'] = 'Origin'
    }
    if (-not $originAllowed) {
        Send-Json $stream 403 'Forbidden' $responseHeaders @{ ok = $false; error = 'origin' }
        return
    }
    if ($method -eq 'OPTIONS') {
        $responseHeaders['Access-Control-Allow-Methods'] = 'GET'
        $responseHeaders['Access-Control-Allow-Headers'] = 'X-Ovolya-Ping'
        $responseHeaders['Access-Control-Allow-Private-Network'] = 'true'
        $responseHeaders['Access-Control-Max-Age'] = '600'
        Send-Response $stream 204 'No Content' $responseHeaders ''
        return
    }
    if ($method -ne 'GET') {
        Send-Json $stream 405 'Method Not Allowed' $responseHeaders @{ ok = $false; error = 'method' }
        return
    }
    # Власний заголовок не може надіслати <img> чи звичайне посилання з іншої сторінки.
    if (-not $headers['x-ovolya-ping']) {
        Send-Json $stream 403 'Forbidden' $responseHeaders @{ ok = $false; error = 'header' }
        return
    }

    $queryStart = $target.IndexOf('?')
    $path = if ($queryStart -ge 0) { $target.Substring(0, $queryStart) } else { $target }
    $query = Get-QueryValues $(if ($queryStart -ge 0) { $target.Substring($queryStart + 1) } else { '' })

    if ($path -eq '/status') {
        Send-Json $stream 200 'OK' $responseHeaders @{ ok = $true; name = 'sd-ping-helper'; version = $Version }
        return
    }
    if ($path -ne '/ping') {
        Send-Json $stream 404 'Not Found' $responseHeaders @{ ok = $false; error = 'path' }
        return
    }

    $addresses = @(([string]$query['ip']).Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
    $invalid = @($addresses | Where-Object { $_ -notmatch $Ipv4Pattern })
    if ($addresses.Count -eq 0 -or $invalid.Count -gt 0 -or $addresses.Count -gt $MaxAddresses) {
        Send-Json $stream 400 'Bad Request' $responseHeaders @{ ok = $false; error = 'ip'; invalid = $invalid }
        return
    }
    $timeout = Get-ClampedInt $query['timeout'] 1000 100 5000
    $count = Get-ClampedInt $query['count'] 2 1 4
    $results = Invoke-Ping $addresses $timeout $count
    $alive = @($results | Where-Object { $_.alive }).Count
    Write-Host ("[{0:HH:mm:ss}] пінг {1} адрес: доступні {2}" -f (Get-Date), $addresses.Count, $alive)
    Send-Json $stream 200 'OK' $responseHeaders @{ ok = $true; results = $results }
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
    $listener.Start()
} catch {
    if (Test-HelperRunning) {
        # Звичайна ситуація після -InstallAutostart: прихований помічник уже працює.
        Write-Host "Помічник пінгу вже працює на 127.0.0.1:$Port (у фоні, з автозапуску або в іншому вікні). Нічого робити не потрібно." -ForegroundColor Green
        Write-Host 'Зупинити його: sd-ping-helper.cmd -Stop'
        Start-Sleep -Seconds 5
        exit 0
    }
    $owner = Get-PortOwner
    $ownerText = if ($owner) { " ($($owner.Name), процес $($owner.ProcessId))" } else { '' }
    Write-Host "Порт $Port на 127.0.0.1 зайнятий іншою програмою$ownerText. Скрипт звертається саме до цього порту." -ForegroundColor Yellow
    exit 1
}
Write-Host "Помічник пінгу v$Version працює на http://127.0.0.1:$Port/ . Не закривайте це вікно (Ctrl+C — зупинити)."
try {
    while ($true) {
        $accept = $listener.AcceptTcpClientAsync()
        # Очікування частинами, щоб Ctrl+C спрацьовував одразу.
        while (-not $accept.Wait(500)) { }
        $client = $accept.Result
        try {
            Invoke-Client $client
        } catch {
            Write-Host "Помилка запиту: $($_.Exception.Message)" -ForegroundColor DarkYellow
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
