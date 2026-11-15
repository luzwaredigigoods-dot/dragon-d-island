# Status line Claude Code untuk Dragon Dynamic Island.
# Claude Code mengirim data sesi (JSON) lewat stdin; skrip ini meneruskannya ke Dragon Dynamic Island
# (yang mencatat persentase batas 5 jam / 7 hari) lalu mencetak teks balasannya sebagai baris status.
# Bila Dragon Dynamic Island tidak berjalan, yang dicetak hanya nama model.
param([string]$Url, [string]$Token, [string]$Tag)

$ErrorActionPreference = 'SilentlyContinue'
$body = [Console]::In.ReadToEnd()
$line = ''
try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method Post -Body $bytes `
        -ContentType 'application/json' -Headers @{ 'X-Dragon-Island' = $Token } -TimeoutSec 2
    $line = [string]$r.Content
} catch {
    try { $line = [string](($body | ConvertFrom-Json).model.display_name) } catch { }
}
[Console]::Out.Write($line)
