$ErrorActionPreference = "Stop"

$project = Resolve-Path (Join-Path $PSScriptRoot "..")
$root = Resolve-Path (Join-Path $project "..")
$legacy = Join-Path $project "legacy"

New-Item -ItemType Directory -Force -Path $legacy | Out-Null

function Find-SourceFile([string] $fileName) {
  $matches = Get-ChildItem -LiteralPath $root -Recurse -File -Filter $fileName |
    Where-Object { $_.FullName -notlike (Join-Path $project "*") } |
    Sort-Object FullName

  if (-not $matches) {
    throw "Source file not found: $fileName"
  }
  if ($matches.Count -gt 1) {
    Write-Warning "Multiple matches for $fileName; using $($matches[0].FullName)"
  }
  return $matches[0].FullName
}

$copies = @(
  @{ FromName = "ccfolia-chat-notifier.user.js"; To = "ccfolia-chat-notifier.user.js" },
  @{ FromName = "ccfolia-format-sync.user.js"; To = "ccfolia-format-sync.user.js" },
  @{ FromName = "ccfolia-log-package.user.js"; To = "ccfolia-log-package.user.js" },
  @{ FromName = "CCFOLIA Roll20 CSS Bridge.js"; To = "ccfolia-roll20-css-bridge.user.js" },
  @{ FromName = "ccfolia-theme-switcher.user.js"; To = "ccfolia-theme-switcher.user.js" },
  @{ FromName = "ccfolia-suite.user.js"; To = "ccfolia-suite.user.js" },
  @{ FromName = "content.js"; ParentName = "cocofolia-standing-picker_v1.5"; To = "ccfolia-standing-picker.content.js" },
  @{ FromName = "style.css"; ParentName = "cocofolia-standing-picker_v1.5"; To = "ccfolia-standing-picker.style.css" }
)

foreach ($copy in $copies) {
  if ($copy.ParentName) {
    $from = Get-ChildItem -LiteralPath $root -Recurse -File -Filter $copy.FromName |
      Where-Object {
        $_.FullName -notlike (Join-Path $project "*") -and
        (Split-Path -Leaf (Split-Path -Parent $_.FullName)) -eq $copy.ParentName
      } |
      Select-Object -First 1 -ExpandProperty FullName
    if (-not $from) {
      throw "Source file not found: $($copy.ParentName)\$($copy.FromName)"
    }
  } else {
    $from = Find-SourceFile $copy.FromName
  }
  $to = Join-Path $legacy $copy.To
  Copy-Item -LiteralPath $from -Destination $to -Force
  Write-Host "synced $($copy.To)"
}
