#!/usr/bin/env pwsh
# Quick smoke test for POST /scan.
# Generates a unique URL each run so the verdict cache always misses
# and the full scraper fan-out actually executes.

$ErrorActionPreference = "Stop"

$api = "http://localhost:3000/scan"

# Unique URL = guid fragment + unix timestamp. Pointed at a domain that
# resolves so WHOIS / Scamadviser have something to look up, but with a
# unique path so the verdict cache key is never reused.
$guid = [guid]::NewGuid().Guid.Substring(0, 8)
$stamp = [int][double]::Parse((Get-Date -UFormat %s))
$uniqueUrl = "https://example.com/sus-test-$guid-$stamp"

$body = @{
    kind    = "url"
    url     = $uniqueUrl
    user_id = "test-script"
} | ConvertTo-Json -Compress

Write-Host ""
Write-Host "POST $api" -ForegroundColor Cyan
Write-Host "  url: $uniqueUrl" -ForegroundColor DarkGray
Write-Host ""

try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-RestMethod -Method Post -Uri $api `
        -ContentType "application/json" -Body $body
    $sw.Stop()
}
catch {
    Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host "Body: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    exit 1
}

$verdictColor = switch ($response.verdict) {
    "Looks Legit"     { "Green" }
    "Suspicious"      { "Yellow" }
    "High Risk"       { "Red" }
    "Not Enough Info" { "DarkGray" }
    default           { "White" }
}

$sep = ("-" * 60)
Write-Host $sep
Write-Host "VERDICT      : " -NoNewline
Write-Host $response.verdict -ForegroundColor $verdictColor
Write-Host "TRUST SCORE  : $($response.trust_score) / 100"
Write-Host "CONFIDENCE   : $($response.confidence)"
Write-Host "ELAPSED      : $([math]::Round($sw.Elapsed.TotalSeconds, 1))s"
Write-Host $sep

Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  $($response.summary)"

Write-Host ""
if ($response.red_flags -and $response.red_flags.Count -gt 0) {
    Write-Host "Red flags:" -ForegroundColor Red
    foreach ($flag in $response.red_flags) {
        Write-Host "  - $flag"
    }
} else {
    Write-Host "Red flags: (none)" -ForegroundColor DarkGray
}

Write-Host ""
if ($response.green_flags -and $response.green_flags.Count -gt 0) {
    Write-Host "Green flags:" -ForegroundColor Green
    foreach ($flag in $response.green_flags) {
        Write-Host "  - $flag"
    }
}

if ($response.sources -and $response.sources.Count -gt 0) {
    Write-Host ""
    Write-Host "Sources ($($response.sources.Count)):" -ForegroundColor Cyan
    foreach ($s in $response.sources) {
        Write-Host "  [$($s.signal_type)] $($s.title)"
        Write-Host "    $($s.url)" -ForegroundColor DarkGray
    }
}

Write-Host ""
