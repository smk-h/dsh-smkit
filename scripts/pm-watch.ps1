param([string]$Watch)
$ids = @($Watch -split ',' | ForEach-Object { [int]$_.Trim() })
$cores = [Environment]::ProcessorCount
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$prev = @{}; $prevAt = 0
while ($true) {
  $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $snap = @{}
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId,WorkingSetSize,KernelModeTime,UserModeTime) {
    $snap[[int]$p.ProcessId] = @{ cpu = ($p.KernelModeTime + $p.UserModeTime) / 1e4; ws = [double]$p.WorkingSetSize }
  }
  $parts = @()
  foreach ($id in $ids) {
    $cur = $snap[$id]
    if ($null -eq $cur) { $parts += "${id},gone"; continue }
    if ($prev.ContainsKey($id) -and $prevAt -gt 0) {
      $dt = $nowMs - $prevAt
      $d = $cur.cpu - $prev[$id].cpu
      # Same window rules as the plugin page (report.ts): 250 ms..5 s, and a
      # negative delta means the pid was recycled. Outside them the field stays
      # empty, exactly like a '-' on the page.
      if ($dt -ge 250 -and $dt -le 5000 -and $d -ge 0) {
        $pct = [math]::Round(($d / $dt / $cores) * 100, 1)
        $parts += ('{0},{1},{2:N0}' -f $id, $pct, ($cur.ws / 1MB))
      } else { $parts += ('{0},,{1:N0}' -f $id, ($cur.ws / 1MB)) }
    } else { $parts += ('{0},,{1:N0}' -f $id, ($cur.ws / 1MB)) }
  }
  Write-Output ("$nowMs|" + ($parts -join '|'))
  $prev = $snap; $prevAt = $nowMs
  Start-Sleep -Milliseconds 900
}
