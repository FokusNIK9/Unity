# Game Builder — ChatGPT App

This app opens a two-field Game Builder inside ChatGPT. The model can also use
`list_project_files`, `read_project_file`, and `write_project_file` to inspect
and update text files inside the local project root.

## Important

The MCP server only allows relative paths below its project root. Put this
folder in the game project directory if you want generated files to appear
there, or set `PROJECT_ROOT` before starting the server.

## One-time setup

Set the runtime key in Windows (use a newly created key; never commit it):

```bat
setx CONTROL_PLANE_API_KEY "PASTE_NEW_KEY_HERE"
```

Open a new terminal after `setx`.

## Start

Double-click `launch_tabs.bat`. It opens one Windows Terminal window with an
MCP tab and an OpenAI tunnel tab. Keep both tabs open while using the app.

In ChatGPT, refresh/reconnect the app and say:

> Открой Game Builder

Then ask explicitly when you want files changed, for example:

> Создай `Assets/Scripts/HeroController.cs` и сохрани его в проект.

The write tool is intentionally limited to the configured project root.
