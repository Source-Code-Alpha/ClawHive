Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c """ & Replace(WScript.ScriptFullName, "start-hidden.vbs", "start.cmd") & """", 0, False
