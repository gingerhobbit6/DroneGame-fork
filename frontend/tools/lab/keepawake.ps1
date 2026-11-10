# Stops Windows going to sleep while a long lab run is going, and lets go the moment it ends.
# It asks Windows not to idle-sleep for as long as this script runs; it changes no setting. Usage: keepawake.ps1 -ProcessId <pid of the run>
param([Parameter(Mandatory = $true)][int]$ProcessId)

Add-Type -Namespace Lab -Name Power -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$ES_CONTINUOUS = 0x80000000; $ES_SYSTEM_REQUIRED = 0x00000001
[void][Lab.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
try {
  while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 20 }
} finally {
  [void][Lab.Power]::SetThreadExecutionState($ES_CONTINUOUS) # back to normal
}
