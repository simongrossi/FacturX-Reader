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

    public static int CloseTauri(uint pid) {
        int posted = 0;
        EnumWindows((hWnd, lParam) => {
            uint procId;
            GetWindowThreadProcessId(hWnd, out procId);
            if (procId == pid) {
                StringBuilder cls = new StringBuilder(256);
                GetClassName(hWnd, cls, 256);
                Console.WriteLine("Window " + hWnd + " class=" + cls.ToString());
                if (cls.ToString() == "Tauri Window") {
                    if (PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero)) posted++;
                }
            }
            return true;
        }, IntPtr.Zero);
        return posted;
    }
}
"@

Add-Type -TypeDefinition $source
$posted = [WinCloseHelper]::CloseTauri([uint32]$ProcessId)
Write-Output "Close requests posted: $posted"
$proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if ($proc -and $posted -eq 0) { Write-Output "Main window close: $($proc.CloseMainWindow())" }
