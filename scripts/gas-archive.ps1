param(
  [Parameter(Mandatory)][ValidateSet('pack','inspect')][string]$Mode,
  [Parameter(Mandatory)][string]$ArchivePath,
  [string]$SourcePath,
  [string]$ResultPath
)
$ErrorActionPreference = 'Stop'
$names = @('App.html','AuthorizeDocs.gs','Billing.gs','CalendarSync.gs','Code.gs','CurrentStatus.gs','IndependentApp.gs','appsscript.json')
if ($Mode -eq 'pack') {
  $source = (Resolve-Path -LiteralPath $SourcePath).Path
  $files = @(Get-ChildItem -LiteralPath $source -Force)
  if ($files.Count -ne $names.Count) { throw 'Candidate must contain exactly eight public files.' }
  foreach ($file in $files) {
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Name -cnotin $names) { throw 'Unexpected candidate entry.' }
  }
  $stream = [IO.File]::Open($ArchivePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {
    $zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
    try {
      foreach ($name in $names) {
        $entry = $zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [DateTimeOffset]::new(1980,1,1,0,0,0,[TimeSpan]::Zero)
        $entry.ExternalAttributes = 0
        $input = [IO.File]::OpenRead((Join-Path $source $name))
        $output = $entry.Open()
        try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
      }
    } finally { $zip.Dispose() }
  } finally { $stream.Dispose() }
} else {
  $stream = [IO.File]::OpenRead($ArchivePath)
  try {
    $zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read,$true)
    try {
      if ($zip.Entries.Count -ne $names.Count) { throw 'Unexpected archive entry count.' }
      $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
      $rows = foreach ($entry in $zip.Entries) {
        if ($entry.FullName -cnotin $names -or -not $seen.Add($entry.FullName) -or $entry.Length -gt 10MB) { throw 'Unsafe or duplicate archive entry.' }
        $input = $entry.Open(); $memory = [IO.MemoryStream]::new()
        try { $input.CopyTo($memory); $bytes = $memory.ToArray() } finally { $input.Dispose(); $memory.Dispose() }
        if ($bytes.Length -ne $entry.Length) { throw 'Archive entry length mismatch.' }
        @{name=$entry.FullName; bytes=$bytes.Length; sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant(); contentBase64=[Convert]::ToBase64String($bytes)}
      }
      [IO.File]::WriteAllText($ResultPath,([object[]]$rows | ConvertTo-Json -Depth 3),[Text.UTF8Encoding]::new($false))
    } finally { $zip.Dispose() }
  } finally { $stream.Dispose() }
}
