# Membaca & mengendalikan media yang sedang diputar di Windows (Spotify, YouTube di browser, dll.)
# lewat System Media Transport Controls. Butuh Windows 10 1809+ dan Windows PowerShell 5.1.
#
# Keluaran : satu baris JSON per pembaruan ke stdout.
# Masukan  : perintah per baris lewat stdin: toggle | next | prev. Stdin ditutup = berhenti.
# Bila pembacaan media gagal, tombol tetap bekerja lewat tombol media keyboard (mode cadangan).

$ErrorActionPreference = 'Stop'

$stdout = [Console]::OpenStandardOutput()
function Emit($obj) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress) + "`n")
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

# ---- tombol media keyboard (cadangan) ----
$keysOk = $false
try {
    Add-Type -Namespace PulauKeys -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);'
    $keysOk = $true
} catch {
    Emit @{ warn = "keys: $($_.Exception.Message)" }
}
function Send-MediaKey([string]$cmd) {
    if (-not $keysOk) { return }
    $vk = switch ($cmd) { 'toggle' { 0xB3 } 'next' { 0xB0 } 'prev' { 0xB1 } default { 0 } }
    if ($vk -eq 0) { return }
    [PulauKeys.U]::keybd_event([byte]$vk, 0, 0, [System.UIntPtr]::Zero)
    [PulauKeys.U]::keybd_event([byte]$vk, 0, 2, [System.UIntPtr]::Zero)
}

# ---- WinRT ----
$mgr = $null
$propsType = $null
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
    try {
        $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
        $null = [Windows.Storage.Streams.IRandomAccessStreamReference, Windows.Storage.Streams, ContentType = WindowsRuntime]
        $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
        $script:streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
    } catch {
        Emit @{ warn = "thumb-type: $($_.Exception.Message)" }
    }
} catch {
    Emit @{ error = "winrt: $($_.Exception.Message)" }
}

function Await($WinRtTask, $ResultType) {
    $asTask = $script:asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    if (-not $netTask.Wait(5000)) { throw 'WinRT timeout' }
    $netTask.Result
}

if ($propsType) {
    try {
        $mgr = Await ($mgrType::RequestAsync()) $mgrType
    } catch {
        Emit @{ error = "manager: $($_.Exception.Message)" }
    }
}
Emit @{ ready = $true; winrt = [bool]$mgr; keys = $keysOk }

# Sampul lagu/video sebagai data URL (atau $null bila tidak ada).
# Objek sampul dan alirannya hanya dikenal PowerShell sebagai objek COM tanpa anggota, jadi semua
# pemanggilan dilakukan lewat tipe antarmukanya (refleksi), bukan $obj.Metode().
function Get-Thumb($props) {
    if (-not $script:streamType) { return $null }
    $ref = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties].GetProperty('Thumbnail').GetValue($props, $null)
    if ($null -eq $ref) { return $null }
    $op = [Windows.Storage.Streams.IRandomAccessStreamReference].GetMethod('OpenReadAsync').Invoke($ref, $null)
    $ras = Await $op $script:streamType
    if ($null -eq $ras) { return $null }
    $size = [int64][Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size').GetValue($ras, $null)
    if ($size -le 0 -or $size -gt 4000000) { return $null }
    $asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1
    } | Select-Object -First 1
    $net = $asStream.Invoke($null, @($ras))
    try {
        $ms = New-Object System.IO.MemoryStream
        $net.CopyTo($ms)
        $bytes = $ms.ToArray()
    } finally {
        try { $net.Dispose() } catch { }
    }
    if ($bytes.Length -lt 16) { return $null }
    # Jenis gambar dikenali dari byte awalnya.
    $type = 'image/png'
    if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) { $type = 'image/jpeg' }
    elseif ($bytes[0] -eq 0x47 -and $bytes[1] -eq 0x49) { $type = 'image/gif' }
    elseif ($bytes[0] -eq 0x42 -and $bytes[1] -eq 0x4D) { $type = 'image/bmp' }
    elseif ($bytes[0] -eq 0x52 -and $bytes[8] -eq 0x57) { $type = 'image/webp' }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
}
$script:thumbKey = ''
$script:thumbTries = 0
$script:thumbWarn = ''

function Get-State {
    if (-not $mgr) { return @{ has = $false } }
    $s = $mgr.GetCurrentSession()
    if (-not $s) { return @{ has = $false } }
    $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
    $t = $s.GetTimelineProperties()
    $info = $s.GetPlaybackInfo()
    $status = "$($info.PlaybackStatus)"
    # Sampul dikirim terpisah, hanya saat lagu berganti (beberapa aplikasi baru mengisinya belakangan).
    $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
    if ($key -ne $script:thumbKey) { $script:thumbKey = $key; $script:thumbTries = 0 }
    if ($script:thumbTries -ge 0 -and $script:thumbTries -lt 12) {
        $script:thumbTries++
        try {
            $thumb = Get-Thumb $p
            if ($thumb) { Emit @{ thumb = $thumb; title = "$($p.Title)" }; $script:thumbTries = -1 }
            elseif ($script:thumbTries -eq 12) { Emit @{ warn = "thumb: aplikasi tidak memberi sampul untuk '$($p.Title)'" } }
        } catch {
            $msg = "$($_.Exception.Message)"
            if ($_.Exception.InnerException) { $msg = "$msg / $($_.Exception.InnerException.Message)" }
            if ($msg -ne $script:thumbWarn) { Emit @{ warn = "thumb: $msg" }; $script:thumbWarn = $msg }
        }
    }
    $pos = $t.Position.TotalSeconds
    # Posisi hanya diperbarui sesekali oleh aplikasi; tambahkan waktu berjalan saat Playing.
    if ($status -eq 'Playing' -and $t.LastUpdatedTime.Year -gt 2000) {
        $pos += ([DateTimeOffset]::Now - $t.LastUpdatedTime).TotalSeconds
    }
    return @{
        has      = $true
        title    = "$($p.Title)"
        artist   = "$($p.Artist)"
        app      = "$($s.SourceAppUserModelId)"
        status   = $status
        position = [math]::Max(0, [math]::Round($pos))
        duration = [math]::Round($t.EndTime.TotalSeconds)
    }
}

function Invoke-Command2([string]$cmd) {
    $done = $false
    if ($mgr) {
        try {
            $s = $mgr.GetCurrentSession()
            if ($s) {
                switch ($cmd) {
                    'toggle' { $done = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
                    'next'   { $done = Await ($s.TrySkipNextAsync()) ([bool]) }
                    'prev'   { $done = Await ($s.TrySkipPreviousAsync()) ([bool]) }
                }
            }
        } catch {
            Emit @{ warn = "cmd ${cmd}: $($_.Exception.Message)" }
        }
    }
    if (-not $done) { Send-MediaKey $cmd }
}

$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $reader.ReadLineAsync()
$tick = 0
$lastErr = ''
while ($true) {
    if ($pending.IsCompleted) {
        $cmd = $pending.Result
        if ($null -eq $cmd) { exit 0 }   # aplikasi induk sudah tutup
        Invoke-Command2 $cmd.Trim()
        $pending = $reader.ReadLineAsync()
        Start-Sleep -Milliseconds 150
        $tick = 0
    }
    if ($tick % 4 -eq 0) {
        try {
            Emit (Get-State)
            $lastErr = ''
        } catch {
            $msg = "$($_.Exception.Message)"
            if ($msg -ne $lastErr) { Emit @{ warn = "state: $msg" }; $lastErr = $msg }
            Emit @{ has = $false }
        }
    }
    $tick++
    Start-Sleep -Milliseconds 250
}
