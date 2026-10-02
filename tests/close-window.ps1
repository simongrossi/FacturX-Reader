param([int]$ProcessId)

$source = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinCloseHelper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public static void CloseTauri(uint pid) {
        EnumWindows((hWnd, lParam) => {
            uint procId;
            GetWindowThreadProcessId(hWnd, out procId);
            if (procId == pid) {
                StringBuilder cls = new StringBuilder(256);
                GetClassName(hWnd, cls, 256);
                if (cls.ToString() == "Tauri Window") {
                    PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
                }
            }
            return true;
        }, IntPtr.Zero);
    }
}
"@

Add-Type -TypeDefinition $source
[WinCloseHelper]::CloseTauri([uint32]$ProcessId)
$proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if ($proc) { $proc.CloseMainWindow() | Out-Null }
