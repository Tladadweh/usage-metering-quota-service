param(
    [Parameter(Mandatory = $true)]
    [string]$ApiKey,

    [Parameter(Mandatory = $true)]
    [string]$UserId
)

$baseUrl = "http://localhost:3000"
$requestCount = 20
$unitsPerRequest = 10

$testRunId = [guid]::NewGuid().ToString("N")

Write-Host "Starting concurrency test..."
Write-Host "Requests: $requestCount"
Write-Host "Units per request: $unitsPerRequest"

$jobs = @()

for ($i = 1; $i -le $requestCount; $i++) {

    $jobs += Start-Job -ScriptBlock {
        param(
            $url,
            $key,
            $user,
            $index,
            $runId,
            $units
        )

        $body = @{
            userId = $user
            units = $units
            requestId = "concurrent-$runId-$index"
        } | ConvertTo-Json

        try {
            $result = Invoke-RestMethod `
                -Uri "$url/consumption" `
                -Method Post `
                -Headers @{ "X-API-Key" = $key } `
                -ContentType "application/json" `
                -Body $body

            return @{
                accepted = $result.accepted
                rejected = -not $result.accepted
                error = $false
                rejectionScope = $result.rejectionScope
            }

        } catch {
            return @{
                accepted = $false
                rejected = $false
                error = $true
                message = $_.Exception.Message
            }
        }

    } -ArgumentList `
        $baseUrl,
        $ApiKey,
        $UserId,
        $i,
        $testRunId,
        $unitsPerRequest
}

$jobs | Wait-Job | Out-Null

$results = @($jobs | Receive-Job)

$jobs | Remove-Job

$accepted = @($results | Where-Object { $_.accepted }).Count

$rejected = @($results | Where-Object { $_.rejected }).Count

$errors = @($results | Where-Object { $_.error }).Count

$totalConsumed = $accepted * $unitsPerRequest

Write-Host ""
Write-Host "========== RESULTS =========="
Write-Host "Accepted: $accepted"
Write-Host "Rejected: $rejected"
Write-Host "Errors: $errors"
Write-Host "Total consumed: $totalConsumed"
Write-Host "============================="

if (
    $accepted -eq 10 -and
    $rejected -eq 10 -and
    $errors -eq 0 -and
    $totalConsumed -eq 100
) {
    Write-Host "PASS: Account quota was respected."
} else {
    Write-Host "FAIL: Unexpected results. Investigate before continuing."
}