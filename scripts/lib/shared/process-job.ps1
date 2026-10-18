param([Parameter(Mandatory=$true)][string]$RequestPath, [switch]$Inspect)
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'process-job.cs')
$request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
if ($Inspect) {
  [SpectreeJob]::Inspect(('Local\Spectree-' + $request.id))
} else {
  [SpectreeJob]::Run($request.id, $request.file, [string[]]$request.args, $request.verbatim, $request.cwd,
    $request.dir, $request.owner_pid, $request.timeout_ms, $request.max_buffer)
}
