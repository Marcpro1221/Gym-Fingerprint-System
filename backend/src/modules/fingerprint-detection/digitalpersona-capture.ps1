param(
  [ValidateSet("status", "capture")]
  [string]$Action = "status",
  [int]$Timeout = 5000
)

$ErrorActionPreference = "Stop"

$paths = [ordered]@{
  sdkAssemblyPath  = "C:\Program Files\DigitalPersona\U.are.U SDK\Windows\Lib\.NET\DPUruNet.dll"
  nativeDriver64   = "C:\Program Files\DigitalPersona\U.are.U SDK\Windows\Lib\x64\dpfpdd.dll"
  nativeDriver32   = "C:\Program Files\DigitalPersona\U.are.U SDK\Windows\Lib\win32\dpfpdd.dll"
  deviceDriverPath = "C:\Program Files\DigitalPersona\Pro Workstation\Bin\dpfpdd5000.dll"
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
    action    = $Action
    message   = $Message
    timestamp = [DateTimeOffset]::Now.ToString("o")
    paths     = $paths
  }
}

function Get-ViewPayload {
  param(
    $CaptureResult
  )

  $views = @()
  if ($CaptureResult -and $CaptureResult.Data -and $CaptureResult.Data.Views) {
    foreach ($view in $CaptureResult.Data.Views) {
      $views += [ordered]@{
        width    = $view.Width
        height   = $view.Height
        rawBytes = $view.RawImage.Length
      }
    }
  }

  return ,$views
}

function Get-ImageStats {
  param(
    [byte[]]$RawImage
  )

  if (-not $RawImage -or $RawImage.Length -eq 0) {
    return $null
  }

  $sum = 0.0
  $sum2 = 0.0
  $min = 255
  $max = 0

  foreach ($byteValue in $RawImage) {
    $sum += $byteValue
    $sum2 += ($byteValue * $byteValue)
    if ($byteValue -lt $min) { $min = $byteValue }
    if ($byteValue -gt $max) { $max = $byteValue }
  }

  $count = $RawImage.Length
  $avg = $sum / $count
  $variance = ($sum2 / $count) - ($avg * $avg)
  if ($variance -lt 0) { $variance = 0 }

  return [ordered]@{
    avg   = [math]::Round($avg, 2)
    std   = [math]::Round([math]::Sqrt($variance), 2)
    min   = $min
    max   = $max
    range = ($max - $min)
    bytes = $count
  }
}

function Get-MeanAbsoluteDifference {
  param(
    [byte[]]$Baseline,
    [byte[]]$Current
  )

  if (-not $Baseline -or -not $Current -or $Baseline.Length -ne $Current.Length) {
    return 0
  }

  $sum = 0.0
  for ($index = 0; $index -lt $Baseline.Length; $index++) {
    $sum += [math]::Abs($Baseline[$index] - $Current[$index])
  }

  return [math]::Round(($sum / $Baseline.Length), 2)
}

function Invoke-StreamContactDetection {
  param(
    $Reader,
    [int]$Timeout,
    $Payload
  )

  $contactThreshold = 18.0
  $Payload["captureMode"] = "stream-contact-detection"
  $Payload["contactThreshold"] = $contactThreshold

  $startStreamingResult = $Reader.StartStreaming()
  $Payload["streamStartResult"] = $startStreamingResult.ToString()

  if ($startStreamingResult -ne [DPUruNet.Constants+ResultCode]::DP_SUCCESS) {
    $Payload["captureMode"] = "single-capture-fallback"
    $Payload["message"] = "Streaming could not be started. Falling back to single capture."
    return $false
  }

  try {
    $baselineResult = $Reader.GetStreamImage(
      [DPUruNet.Constants+Formats+Fid]::ANSI,
      [DPUruNet.Constants+CaptureProcessing]::DP_IMG_PROC_DEFAULT,
      500
    )

    $Payload["baselineResultCode"] = $baselineResult.ResultCode.ToString()
    $Payload["baselineQuality"] = $baselineResult.Quality.ToString()

    $baselineViews = Get-ViewPayload -CaptureResult $baselineResult
    $Payload["baselineViews"] = $baselineViews

    if ($baselineResult.ResultCode -ne [DPUruNet.Constants+ResultCode]::DP_SUCCESS -or $baselineViews.Count -eq 0) {
      $Payload["captureMode"] = "single-capture-fallback"
      $Payload["message"] = "Could not collect a baseline stream image. Falling back to single capture."
      return $false
    }

    $baselineImage = $baselineResult.Data.Views[0].RawImage
    $Payload["baselineStats"] = Get-ImageStats -RawImage $baselineImage

    $deadline = [DateTimeOffset]::Now.AddMilliseconds($Timeout)
    $lastDifference = 0

    while ([DateTimeOffset]::Now -lt $deadline) {
      $streamResult = $Reader.GetStreamImage(
        [DPUruNet.Constants+Formats+Fid]::ANSI,
        [DPUruNet.Constants+CaptureProcessing]::DP_IMG_PROC_DEFAULT,
        500
      )

      $Payload["resultCode"] = $streamResult.ResultCode.ToString()
      $Payload["quality"] = $streamResult.Quality.ToString()
      $Payload["score"] = $streamResult.Score

      $streamViews = Get-ViewPayload -CaptureResult $streamResult
      $Payload["views"] = $streamViews

      if ($streamResult.ResultCode -ne [DPUruNet.Constants+ResultCode]::DP_SUCCESS) {
        $Payload["success"] = $false
        $Payload["captured"] = $false
        $Payload["contactDetected"] = $false
        $Payload["message"] = "Stream capture failed with result $($streamResult.ResultCode)."
        return $true
      }

      if ($streamViews.Count -gt 0) {
        $currentImage = $streamResult.Data.Views[0].RawImage
        $lastDifference = Get-MeanAbsoluteDifference -Baseline $baselineImage -Current $currentImage
        $Payload["contactMeanAbsDiff"] = $lastDifference
        $Payload["currentStats"] = Get-ImageStats -RawImage $currentImage

        if ($lastDifference -ge $contactThreshold) {
          $Payload["captured"] = $true
          $Payload["contactDetected"] = $true
          $Payload["message"] = "Finger contact detected on the reader."
          return $true
        }
      }
    }

    $Payload["resultCode"] = [DPUruNet.Constants+ResultCode]::DP_SUCCESS.ToString()
    $Payload["quality"] = [DPUruNet.Constants+CaptureQuality]::DP_QUALITY_TIMED_OUT.ToString()
    $Payload["score"] = 0
    $Payload["captured"] = $false
    $Payload["contactDetected"] = $false
    $Payload["contactMeanAbsDiff"] = $lastDifference
    $Payload["message"] = "No finger contact was detected within the timeout window."
    return $true
  }
  finally {
    try {
      $Reader.StopStreaming() | Out-Null
    }
    catch {
    }
  }
}

try {
  if (-not (Test-Path -LiteralPath $paths.sdkAssemblyPath)) {
    Write-Json -Payload (New-Response -Success $false -Message "DPUruNet.dll was not found at the configured SDK path.")
    exit 0
  }

  Add-Type -Path $paths.sdkAssemblyPath

  $readers = [DPUruNet.ReaderCollection]::GetReaders()
  if (-not $readers -or $readers.Count -eq 0) {
    $payload = New-Response -Success $false -Message "No DigitalPersona reader was detected."
    $payload["readerCount"] = 0
    Write-Json -Payload $payload
    exit 0
  }

  $reader = $readers[0]
  $payload = New-Response -Success $true -Message "Reader detected."
  $payload["readerCount"] = $readers.Count
  $payload["readerSerial"] = $reader.Description.SerialNumber

  try {
    $openResult = $reader.Open([DPUruNet.Constants+CapturePriority]::DP_PRIORITY_COOPERATIVE)
    $payload["openResult"] = $openResult.ToString()

    if ($openResult -ne [DPUruNet.Constants+ResultCode]::DP_SUCCESS) {
      $payload["success"] = $false
      $payload["message"] = "Reader open failed with result $openResult."
      Write-Json -Payload $payload
      exit 0
    }

    $statusResult = $reader.GetStatus()
    $payload["statusResult"] = $statusResult.ToString()
    if ($statusResult -ne [DPUruNet.Constants+ResultCode]::DP_SUCCESS) {
      throw "Reader status check failed with result $statusResult."
    }

    if (-not $reader.Capabilities.Resolutions -or $reader.Capabilities.Resolutions.Count -eq 0) {
      throw "Reader did not report a usable scan resolution."
    }

    $payload["readerStatus"] = $reader.Status.Status.ToString()
    $payload["resolution"] = $reader.Capabilities.Resolutions[0]
    $payload["canStream"] = [bool]$reader.Capabilities.CanStream

    if ($reader.Status.Status -eq [DPUruNet.Constants+ReaderStatuses]::DP_STATUS_BUSY) {
      Start-Sleep -Milliseconds 50
      $null = $reader.GetStatus()
      $payload["readerStatus"] = $reader.Status.Status.ToString()
    }

    if ($reader.Status.Status -eq [DPUruNet.Constants+ReaderStatuses]::DP_STATUS_NEED_CALIBRATION) {
      $reader.Calibrate()
      $null = $reader.GetStatus()
      $payload["readerStatus"] = $reader.Status.Status.ToString()
    }

    if ($reader.Status.Status -ne [DPUruNet.Constants+ReaderStatuses]::DP_STATUS_READY) {
      throw "Reader status is not ready: $($reader.Status.Status)."
    }

    if ($Action -eq "capture") {
      $payload["timeout"] = $Timeout
      $payload["captured"] = $false
      $payload["contactDetected"] = $false

      if ($reader.Capabilities.CanStream) {
        $handledByStream = Invoke-StreamContactDetection `
          -Reader $reader `
          -Timeout $Timeout `
          -Payload $payload

        if ($handledByStream) {
          Write-Json -Payload $payload
          exit 0
        }
      }

      $capture = $reader.Capture(
        [DPUruNet.Constants+Formats+Fid]::ANSI,
        [DPUruNet.Constants+CaptureProcessing]::DP_IMG_PROC_DEFAULT,
        $Timeout,
        $reader.Capabilities.Resolutions[0]
      )

      $payload["captureMode"] = "single-capture-fallback"
      $payload["resultCode"] = $capture.ResultCode.ToString()
      $payload["quality"] = $capture.Quality.ToString()
      $payload["score"] = $capture.Score
      $views = Get-ViewPayload -CaptureResult $capture
      $payload["views"] = $views
      $payload["captured"] = (
        $capture.ResultCode -eq [DPUruNet.Constants+ResultCode]::DP_SUCCESS -and
        $capture.Quality -eq [DPUruNet.Constants+CaptureQuality]::DP_QUALITY_GOOD -and
        $views.Count -gt 0
      )
      $payload["contactDetected"] = $payload["captured"]

      switch ($capture.Quality) {
        ([DPUruNet.Constants+CaptureQuality]::DP_QUALITY_GOOD) {
          $payload["message"] = "Fingerprint captured successfully."
        }
        ([DPUruNet.Constants+CaptureQuality]::DP_QUALITY_TIMED_OUT) {
          $payload["message"] = "No finger was captured before the timeout expired."
        }
        ([DPUruNet.Constants+CaptureQuality]::DP_QUALITY_NO_FINGER) {
          $payload["message"] = "No finger was detected on the reader."
        }
        ([DPUruNet.Constants+CaptureQuality]::DP_QUALITY_FAKE_FINGER) {
          $payload["message"] = "The reader rejected the sample as a fake finger."
        }
        default {
          $payload["message"] = "Capture finished with quality $($capture.Quality)."
        }
      }
    }

    Write-Json -Payload $payload
  }
  finally {
    if ($reader) {
      $reader.Dispose()
    }
  }
}
catch {
  $payload = New-Response -Success $false -Message $_.Exception.Message
  Write-Json -Payload $payload
}
