property launcherPath : "__HARK_LAUNCHER__"

on run
    try
        do shell script "/usr/bin/python3 " & quoted form of launcherPath
    on error errorText
        display alert "Hark 启动失败" message errorText as warning buttons {"好"} default button "好"
    end try
end run
