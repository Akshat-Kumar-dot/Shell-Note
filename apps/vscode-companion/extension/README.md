# ShellNote companion

Tells ShellNote which file and line this VS Code window is at, so a line of notes written beside it can go back there.

It only writes one small file on this computer while the window is open (`%LOCALAPPDATA%\shellnote\vscode\`), holding
the workspace's name, the file's path, the line and the time. It uses no network and no port, and reads none of your code.
