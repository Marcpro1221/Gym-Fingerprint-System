param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath
)

$ErrorActionPreference = "Stop"

$paths = [ordered]@{
  sdkAssemblyPath = "C:\Program Files\DigitalPersona\U.are.U SDK\Windows\Lib\.NET\DPUruNet.dll"
}

function Write-Json {
  param(
    [Parameter(Mandatory = $true)]
    $Payload
  )

  if ($Payload -is [System.Collections.IDictionary]) {
    $Payload["timestamp"] = [DateTimeOffset]::Now.ToString("o")
  }

  $Payload | ConvertTo-Json -Depth 8 -Compress
}

function New-Response {
  param(
    [bool]$Success,
    [string]$Message
  )

  return [ordered]@{
    success   = $Success
    action    = "identify"
    message   = $Message
    timestamp = [DateTimeOffset]::Now.ToString("o")
    paths     = $paths
  }
}

function Read-InputPayload {
  param(
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Matcher input payload was not found."
  }

  $rawJson = Get-Content -LiteralPath $Path -Raw
  if ([string]::IsNullOrWhiteSpace($rawJson)) {
    throw "Matcher input payload is empty."
  }

  return $rawJson | ConvertFrom-Json
}

function Get-IntegerValue {
  param(
    $Value,
    [int]$Fallback = 0
  )

  if ($null -eq $Value) {
    return $Fallback
  }

  $parsed = 0
  if ([int]::TryParse([string]$Value, [ref]$parsed)) {
    return $parsed
  }

  return $Fallback
}

function Convert-ToFmd {
  param(
    $Template
  )

  if (-not $Template) {
    throw "Fingerprint matcher template is missing."
  }

  $templateDataBase64 = [string]$Template.templateDataBase64
  if ([string]::IsNullOrWhiteSpace($templateDataBase64)) {
    throw "Fingerprint matcher template data is missing."
  }

  $rawImageData = [Convert]::FromBase64String($templateDataBase64)
  $width = Get-IntegerValue -Value $Template.width
  $height = Get-IntegerValue -Value $Template.height
  $resolution = Get-IntegerValue -Value $Template.resolution -Fallback 500
  $fingerPosition = Get-IntegerValue -Value $Template.fingerPosition
  $cbeffId = Get-IntegerValue -Value $Template.cbeffId

  if ($width -le 0 -or $height -le 0) {
    throw "Fingerprint matcher template dimensions are invalid."
  }

  if ($rawImageData.Length -eq 0) {
    throw "Fingerprint matcher template bytes are empty."
  }

  $fmdResult = [DPUruNet.FeatureExtraction]::CreateFmdFromRaw(
    $rawImageData,
    $fingerPosition,
    $cbeffId,
    $width,
    $height,
    $resolution,
    [DPUruNet.Constants+Formats+Fmd]::ANSI
  )

  if ($fmdResult.ResultCode -ne [DPUruNet.Constants+ResultCode]::DP_SUCCESS) {
    throw "Feature extraction failed with result $($fmdResult.ResultCode)."
  }

  return $fmdResult.Data
}

try {
  if (-not (Test-Path -LiteralPath $paths.sdkAssemblyPath)) {
    Write-Json -Payload (New-Response -Success $false -Message "DPUruNet.dll was not found at the configured SDK path.")
    exit 0
  }

  Add-Type -Path $paths.sdkAssemblyPath

  $inputPayload = Read-InputPayload -Path $InputPath
  if (-not $inputPayload.probe) {
    throw "Probe fingerprint template is required."
  }

  $probeFmd = Convert-ToFmd -Template $inputPayload.probe
  $thresholdScore = Get-IntegerValue -Value $inputPayload.thresholdScore -Fallback 21474
  $candidateList = @($inputPayload.candidates)

  $payload = New-Response -Success $true -Message "Fingerprint comparison completed."
  $payload["thresholdScore"] = $thresholdScore
  $payload["candidateCount"] = $candidateList.Count
  $payload["comparedCandidates"] = 0
  $payload["skippedCandidates"] = 0
  $payload["matched"] = $false
  $payload["matchedFingerprintId"] = $null

  $bestScore = $null
  $bestFingerprintId = $null

  foreach ($candidate in $candidateList) {
    if (-not $candidate) {
      $payload["skippedCandidates"] = [int]$payload["skippedCandidates"] + 1
      continue
    }

    try {
      $candidateFmd = Convert-ToFmd -Template $candidate
      $compareResult = [DPUruNet.Comparison]::Compare($probeFmd, 0, $candidateFmd, 0)

      if ($compareResult.ResultCode -ne [DPUruNet.Constants+ResultCode]::DP_SUCCESS) {
        throw "Comparison failed with result $($compareResult.ResultCode)."
      }

      $payload["comparedCandidates"] = [int]$payload["comparedCandidates"] + 1
      $score = [int]$compareResult.Score

      if ($null -eq $bestScore -or $score -lt $bestScore) {
        $bestScore = $score
        $bestFingerprintId = [string]$candidate.fingerprintId
      }
    }
    catch {
      $payload["skippedCandidates"] = [int]$payload["skippedCandidates"] + 1
    }
  }

  if ($null -ne $bestScore) {
    $payload["bestScore"] = $bestScore
    $payload["matchedFingerprintId"] = $bestFingerprintId
    $payload["matched"] = (
      -not [string]::IsNullOrWhiteSpace($bestFingerprintId) -and
      $bestScore -lt $thresholdScore
    )
  }

  if ($payload["matched"]) {
    $payload["message"] = "Fingerprint match found."
  }
  elseif ($payload["comparedCandidates"] -eq 0) {
    $payload["message"] = "No comparable fingerprint templates were available for matching."
  }
  else {
    $payload["message"] = "No stored fingerprint template matched the captured scan."
  }

  Write-Json -Payload $payload
}
catch {
  $payload = New-Response -Success $false -Message $_.Exception.Message
  Write-Json -Payload $payload
}
