# The helper of apps-check.mjs (other programs on a panel, src-tauri/src/apps.rs): a test window of its own, titled
# "shellnote-apps-check", and Windows' answers about windows, one line of JSON for each line asked on its input:
#   new                  a test window (another, when one was closed): {"hwnd":N}
#   main PID             that process's main window: {"hwnd":N}
#   seen H               what is seen of window H, without its invisible borders: {"l":..,"t":..,"r":..,"b":..}
# owner H / visible H its owner, whether it is shown: {"owner":N} / {"visible":true}
#   nudge H DX DY        window H moved by DX, DY, as the person drags shellnote: {"ok":true}
#   front H              window H brought in front, as a click would: {"front":true}
#   at X Y               the top-level window seen at that point of the screen: {"hwnd":N}
#   show H CMD           ShowWindow(H, CMD): 6 minimise, 9 restore
#   retitle TEXT         the test window's title changed: {"ok":true}
#   drag DX DY           the test window moved by itself, as the person drags it off: {"ok":true}
#   close                the test window closed: {"ok":true}
# Run by apps-check.mjs; it touches only its own window and ShellNote's check copy.
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class Check {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);

  public static Form Window;

  public static long Make() {
    SetProcessDpiAwarenessContext(new IntPtr(-4));  // real pixels, as ShellNote has them
    var ready = new ManualResetEvent(false);
    var ui = new Thread(delegate () {
      Window = new Form { Text = "shellnote-apps-check", StartPosition = FormStartPosition.Manual, Left = 60, Top = 60, Width = 640, Height = 420, BackColor = Color.FromArgb(240, 236, 226) };
      Window.Controls.Add(new Label { Text = "A test window of ShellNote's check (apps-check.mjs)", Dock = DockStyle.Fill, Font = new Font("Segoe UI", 12) });
      Window.Shown += delegate { ready.Set(); };
      Application.Run(Window);
    });
    ui.SetApartmentState(ApartmentState.STA);
    ui.IsBackground = true;
    ui.Start();
    ready.WaitOne();
    return Window.Handle.ToInt64();
  }

  // On the window's own thread (PowerShell's script blocks cannot run there).
  public static void Retitle(string t) { Window.Invoke((MethodInvoker)delegate { Window.Text = t; }); }
  public static void Drag(int dx, int dy) { Window.Invoke((MethodInvoker)delegate { Window.Left += dx; Window.Top += dy; }); }
  public static void Close() { Window.Invoke((MethodInvoker)delegate { Window.Close(); }); }
  // The window stops answering for a while, as a hung program does: its own thread asleep (the helper answers on).
  public static void Hang(int ms) { Window.BeginInvoke((MethodInvoker)delegate { Thread.Sleep(ms); }); }
  // A colour of its own, for the picture's checks (the label over it takes it too).
  public static void Paint(int r, int g, int b) { Window.Invoke((MethodInvoker)delegate { Window.BackColor = Color.FromArgb(r, g, b); }); }
  // Its colour changed about 60 times a second for a while, as a playing video changes: the picture's frames are counted.
  public static void Flicker(int ms) {
    Window.BeginInvoke((MethodInvoker)delegate {
      var timer = new System.Windows.Forms.Timer { Interval = 15 };
      var until = DateTime.Now.AddMilliseconds(ms);
      var n = 0;
      timer.Tick += delegate { n++; Window.BackColor = Color.FromArgb(n % 200, 120, 200 - n % 200); if (DateTime.Now > until) timer.Stop(); };
      timer.Start();
    });
  }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);

  public static string Seen(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return String.Format("{{\"l\":{0},\"t\":{1},\"r\":{2},\"b\":{3}}}", r.L, r.T, r.R, r.B);
  }

  public static long Owner(IntPtr h) { return GetWindowLongPtr(h, -8).ToInt64(); }

  public static bool Nudge(IntPtr h, int dx, int dy) {
    RECT r;
    GetWindowRect(h, out r);
    return SetWindowPos(h, IntPtr.Zero, r.L + dx, r.T + dy, 0, 0, 0x1 | 0x4 | 0x10);  // no size, no order, no activation
  }

  public static bool Front(IntPtr h) {
    keybd_event(0x12, 0, 0x1, UIntPtr.Zero);
    SetForegroundWindow(h);
    keybd_event(0x12, 0, 0x3, UIntPtr.Zero);
    Thread.Sleep(300);
    return GetForegroundWindow() == h;
  }

  public static long At(int x, int y) { return GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2).ToInt64(); }
}
'@

function Say($json) { [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
function Handle($text) { [IntPtr][long]$text }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Trim() -split ' ', 2
  $rest = if ($parts.Count -gt 1) { $parts[1] } else { '' }
  $args2 = $rest -split ' '
  try {
    switch ($parts[0]) {
      'new' { Say "{`"hwnd`":$([Check]::Make())}" }
      'main' { Say "{`"hwnd`":$((Get-Process -Id ([int]$rest)).MainWindowHandle.ToInt64())}" }
      'seen' { Say ([Check]::Seen((Handle $rest))) }
      'owner' { Say "{`"owner`":$([Check]::Owner((Handle $rest)))}" }
      'visible' { Say "{`"visible`":$(([Check]::IsWindowVisible((Handle $rest))).ToString().ToLower())}" }
      'nudge' { Say "{`"ok`":$(([Check]::Nudge((Handle $args2[0]), [int]$args2[1], [int]$args2[2])).ToString().ToLower())}" }
      'front' { Say "{`"front`":$(([Check]::Front((Handle $rest))).ToString().ToLower())}" }
      'at' { Say "{`"hwnd`":$([Check]::At([int]$args2[0], [int]$args2[1]))}" }
      'show' { [void][Check]::ShowWindow((Handle $args2[0]), [int]$args2[1]); Start-Sleep -Milliseconds 500; Say '{"ok":true}' }
      'retitle' { [Check]::Retitle($rest); Say '{"ok":true}' }
      'drag' { [Check]::Drag([int]$args2[0], [int]$args2[1]); Say '{"ok":true}' }
      'close' { [Check]::Close(); Say '{"ok":true}' }
      'hang' { [Check]::Hang([int]$rest); Say '{"ok":true}' }
      'paint' { [Check]::Paint([int]$args2[0], [int]$args2[1], [int]$args2[2]); Say '{"ok":true}' }
      'flicker' { [Check]::Flicker([int]$rest); Say '{"ok":true}' }
      'alive' { Say "{`"alive`":$(([Check]::IsWindow((Handle $rest))).ToString().ToLower())}" }
      'zoomed' { Say "{`"zoomed`":$(([Check]::IsZoomed((Handle $rest))).ToString().ToLower())}" }
      default { Say "{`"error`":`"unknown: $($parts[0])`"}" }
    }
  } catch {
    Say "{`"error`":$(ConvertTo-Json ([string]$_))}"
  }
}
