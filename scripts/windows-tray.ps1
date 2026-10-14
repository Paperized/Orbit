param([int]$CommandId = 0)
$ErrorActionPreference = 'Stop'
$expected = Join-Path $env:LOCALAPPDATA 'Orbit-interop-test\orbit-overlay.exe'
$processes = @(Get-Process | Where-Object { $_.Path -eq $expected })
if ($processes.Count -ne 1) { throw 'Expected exactly one isolated Orbit test process' }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public class TrayEntry {
    public string text;
    public uint id;
    public bool enabled;
    public List<TrayEntry> children;
}
public static class NativeTray {
    delegate bool EnumProc(IntPtr window, IntPtr value);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr value);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu, int position);
    [DllImport("user32.dll")] static extern uint GetMenuState(IntPtr menu, uint position, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu, int position);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int size, uint flags);
    static IntPtr Find(uint process, string className) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, value) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            var name = new StringBuilder(256); GetClassName(window, name, name.Capacity);
            if (owner == process && name.ToString() == className) { found = window; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    static List<TrayEntry> Read(IntPtr menu) {
        var entries = new List<TrayEntry>();
        for (int i=0; i<GetMenuItemCount(menu); i++) {
            var text = new StringBuilder(512); GetMenuString(menu, (uint)i, text, text.Capacity, 0x400);
            var child = GetSubMenu(menu, i);
            entries.Add(new TrayEntry { text=text.ToString(), id=GetMenuItemID(menu,i),
                enabled=(GetMenuState(menu,(uint)i,0x400)&3)==0,
                children=child==IntPtr.Zero ? new List<TrayEntry>() : Read(child) });
        }
        return entries;
    }
    static bool Contains(List<TrayEntry> entries, uint id) {
        foreach (var entry in entries) if ((entry.id==id && entry.enabled) || Contains(entry.children,id)) return true;
        return false;
    }
    public static List<TrayEntry> Snapshot(uint process, uint command) {
        var owner = Find(process,"tray_icon_app");
        if (owner==IntPtr.Zero) throw new Exception("Tray owner not found");
        // tray-icon 0.25 forwards native right-button release through message 6002.
        if (!PostMessage(owner,6002,IntPtr.Zero,new IntPtr(0x205))) throw new Exception("Cannot open tray menu");
        IntPtr popup=IntPtr.Zero;
        try {
            for(int i=0;i<100 && popup==IntPtr.Zero;i++) { Thread.Sleep(50); popup=Find(process,"#32768"); }
            if(popup==IntPtr.Zero) throw new Exception("Native tray popup not found");
            var menu=SendMessage(popup,0x1e1,IntPtr.Zero,IntPtr.Zero);
            if(menu==IntPtr.Zero) throw new Exception("Native menu handle not found");
            var entries=Read(menu);
            if(command!=0 && !Contains(entries,command)) throw new Exception("Menu command is not currently available");
            PostMessage(owner,0x1f,IntPtr.Zero,IntPtr.Zero);
            Thread.Sleep(100);
            if(command!=0 && !PostMessage(owner,0x111,new IntPtr(command),IntPtr.Zero)) throw new Exception("Menu command failed");
            return entries;
        } finally { PostMessage(owner,0x1f,IntPtr.Zero,IntPtr.Zero); }
    }
}
'@
[NativeTray]::Snapshot($processes[0].Id, $CommandId) | ConvertTo-Json -Depth 12 -Compress
