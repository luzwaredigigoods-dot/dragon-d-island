# Memantau jendela yang sedang aktif (terbuka penuh atau tidak) dan tombol kiri mouse (untuk mengenali seretan).
# Keluaran: satu baris JSON ke stdout setiap kali keadaan berubah. Stdin ditutup = berhenti.
param([int]$SelfPid = 0)

$ErrorActionPreference = 'Stop'

$stdout = [Console]::OpenStandardOutput()
function Emit($obj) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress) + "`n")
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PulauWin {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

    // Tombol utama mouse sedang ditekan? (memperhitungkan mouse kidal yang tombolnya ditukar)
    public static bool LeftDown() {
        int vk = GetSystemMetrics(23) != 0 ? 0x02 : 0x01;
        return (GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    // self | desktop | other-monitor | fullscreen | maximized | normal | none
    public static string State(uint selfPid) {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "none";
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (selfPid != 0 && pid == selfPid) return "self";
        StringBuilder sb = new StringBuilder(256);
        GetClassName(h, sb, 256);
        string cls = sb.ToString();
        if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd"
            || cls == "Windows.UI.Core.CoreWindow" || cls == "XamlExplorerHostIslandWindow"
            || cls == "TopLevelWindowForOverflowXamlIsland" || cls == "NotifyIconOverflowWindow") return "desktop";
        if (IsIconic(h)) return "normal";
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return "normal";
        if ((mi.dwFlags & 1) == 0) return "other-monitor";
        RECT r;
        if (!GetWindowRect(h, out r)) return "normal";
        bool full = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top
                 && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
        if (IsZoomed(h)) return "maximized";
        if (full) return "fullscreen";
        return "normal";
    }
}
"@
} catch {
    Emit @{ error = "addtype: $($_.Exception.Message)" }
    exit 1
}

Emit @{ ready = $true }

$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $reader.ReadLineAsync()
$last = ''
$lastLb = $null
$lastErr = ''
$n = 0
while ($true) {
    if ($pending.IsCompleted) {
        if ($null -eq $pending.Result) { exit 0 }   # aplikasi induk sudah tutup
        $pending = $reader.ReadLineAsync()
    }
    try {
        $lb = [PulauWin]::LeftDown()
        if ($lb -ne $lastLb) { Emit @{ lb = $lb }; $lastLb = $lb }
        if ($n % 4 -eq 0) {
            $state = [PulauWin]::State([uint32]$SelfPid)
            if ($state -ne $last) { Emit @{ state = $state }; $last = $state }
        }
    } catch {
        $msg = "$($_.Exception.Message)"
        if ($msg -ne $lastErr) { Emit @{ error = "state: $msg" }; $lastErr = $msg }
    }
    $n++
    Start-Sleep -Milliseconds 80
}
