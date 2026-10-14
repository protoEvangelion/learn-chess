# Publishes the WSL dev server on this PC's Wi-Fi address.
# NAT: Windows accepts LAN connections and forwards the raw TCP stream
# (including the live-reload websocket) to Linux. The Linux address is
# re-read, so a WSL IP change does not leave a stale forward in place.
# Mirrored: Linux is already on the Wi-Fi card. This script only removes
# the old port forward that would block that bind.

$ErrorActionPreference = 'Stop'
$Port = 5173
$AppDir = Join-Path $env:LOCALAPPDATA 'learn-chess'
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
$PidFile = Join-Path $AppDir 'lan-bridge.pid'
$LogFile = Join-Path $AppDir 'lan-bridge.log'

function Say([string]$Line) {
  [Console]::Out.WriteLine($Line)
  [Console]::Out.Flush()
  Add-Content -Path $LogFile -Value "$(Get-Date -Format o) $Line"
}

function Get-LanIPv4 {
  @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.AddressState -eq 'Preferred' -and
      $_.InterfaceAlias -notmatch 'vEthernet|Loopback|WSL|Hyper-V|Default Switch'
    } |
    Select-Object -ExpandProperty IPAddress)
}

function Get-WslIPv4 {
  $out = & wsl.exe -e hostname -I 2>$null
  if (-not $out) { return @() }
  @($out -split '\s+' | Where-Object {
    $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '127.*' -and $_ -ne '10.255.255.254'
  })
}

function Test-Mirrored([string[]]$Lan, [string[]]$Wsl) {
  foreach ($ip in $Lan) {
    if ($Wsl -contains $ip) { return $true }
  }
  return $false
}

function Remove-PortProxy([int]$ListenPort) {
  & netsh.exe interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$ListenPort | Out-Null
}

function Stop-OldBridge {
  if (-not (Test-Path $PidFile)) { return }
  $old = Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($old -match '^\d+$' -and [int]$old -ne $PID) {
    Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

try {
  $lan = @(Get-LanIPv4)
  $wsl = @(Get-WslIPv4)
  $mirrored = Test-Mirrored $lan $wsl
  Stop-OldBridge
  Remove-PortProxy $Port

  try {
    $rule = Get-NetFirewallRule -DisplayName 'WSL Vite 5173' -ErrorAction SilentlyContinue
    if ($rule) {
      Set-NetFirewallRule -DisplayName 'WSL Vite 5173' -EdgeTraversalPolicy Allow -Enabled True | Out-Null
    } else {
      New-NetFirewallRule -DisplayName 'WSL Vite 5173' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any -EdgeTraversalPolicy Allow | Out-Null
    }
  } catch {}

  try {
    $hyperv = Get-NetFirewallHyperVRule -Name 'LearnChessVite5173' -ErrorAction SilentlyContinue
    if (-not $hyperv) {
      New-NetFirewallHyperVRule -Name 'LearnChessVite5173' -DisplayName 'Learn Chess Vite 5173' -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts $Port -Action Allow | Out-Null
    }
  } catch {}

  if ($mirrored) {
    Remove-PortProxy 2222
    Say 'MODE mirrored'
    foreach ($ip in $lan) { Say "LAN http://${ip}:${Port}/" }
    Say 'READY'
    exit 0
  }

  if ($wsl.Count -eq 0) {
    [Console]::Error.WriteLine('Could not read the Linux address, so the Wi-Fi forwarder did not start.')
    Say 'MODE error'
    Say 'READY'
    exit 1
  }

  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace LearnChess {
  public static class LanBridge {
    static volatile string targetIp;
    static int port;
    static TcpListener listener;

    public static void Start(string ip, int listenPort) {
      targetIp = ip;
      port = listenPort;
      Exception last = null;
      for (int i = 0; i < 20; i++) {
        listener = new TcpListener(IPAddress.Any, port);
        try {
          listener.Start();
          last = null;
          break;
        } catch (Exception ex) {
          last = ex;
          Thread.Sleep(250);
        }
      }
      if (last != null) throw last;
      ThreadPool.QueueUserWorkItem(_ => AcceptLoop());
      ThreadPool.QueueUserWorkItem(_ => RefreshLoop());
    }

    public static void WaitForever() {
      Thread.Sleep(Timeout.Infinite);
    }

    static void RefreshLoop() {
      while (true) {
        Thread.Sleep(5000);
        try {
          var next = Query();
          if (next != null) targetIp = next;
        } catch {}
      }
    }

    static string Query() {
      var psi = new ProcessStartInfo();
      psi.FileName = "wsl.exe";
      psi.Arguments = "-e hostname -I";
      psi.RedirectStandardOutput = true;
      psi.UseShellExecute = false;
      psi.CreateNoWindow = true;
      var proc = Process.Start(psi);
      var text = proc.StandardOutput.ReadToEnd();
      if (!proc.WaitForExit(8000)) {
        try { proc.Kill(); } catch {}
        return null;
      }
      var parts = text.Split(new char[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
      foreach (var part in parts) {
        IPAddress parsed;
        if (IPAddress.TryParse(part, out parsed) && parsed.AddressFamily == AddressFamily.InterNetwork && part != "10.255.255.254" && !part.StartsWith("127."))
          return part;
      }
      return null;
    }

    static void AcceptLoop() {
      while (true) {
        TcpClient client;
        try { client = listener.AcceptTcpClient(); }
        catch { break; }
        ThreadPool.QueueUserWorkItem(state => Pipe((TcpClient)state), client);
      }
    }

    static void Pipe(TcpClient client) {
      TcpClient remote = null;
      try {
        client.NoDelay = true;
        remote = Connect();
        remote.NoDelay = true;
        var left = client.GetStream();
        var right = remote.GetStream();
        var toRemote = left.CopyToAsync(right);
        var toClient = right.CopyToAsync(left);
        Task.WaitAny(toRemote, toClient);
      } catch {}
      finally {
        try { client.Close(); } catch {}
        if (remote != null) try { remote.Close(); } catch {}
      }
    }

    static TcpClient Connect() {
      Exception last = null;
      for (int i = 0; i < 2; i++) {
        try {
          var client = new TcpClient();
          client.Connect(IPAddress.Parse(targetIp), port);
          return client;
        } catch (Exception ex) {
          last = ex;
          var next = Query();
          if (next != null) targetIp = next;
        }
      }
      throw last;
    }
  }
}
'@

  [LearnChess.LanBridge]::Start($wsl[0], $Port)
  Set-Content -Path $PidFile -Value $PID -Encoding ascii
  Say 'MODE bridge'
  foreach ($ip in $lan) { Say "LAN http://${ip}:${Port}/" }
  Say 'READY'
  [LearnChess.LanBridge]::WaitForever()
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  Say 'MODE error'
  Say 'READY'
  exit 1
}
