# Default host for a project

When a project is on more than one server, you can choose which one new threads in it start on.
Each device keeps its own choice, so your phone can start chats on a server while your Mac starts
them locally.

- **Web and desktop:** open the project's settings (right-click it in the sidebar's project list)
  and set **Default host**.
- **iPhone and iPad:** open **Settings**, pick the project in the filter at the top, then open
  **Projects & threads → Overview** and choose a host under **Default host**.

**Automatic** keeps the usual behavior. If the default host is offline or no longer has the
project, new threads use Automatic; the host shown in the draft tells you where it will run, and
you can still switch it there. On web and desktop, a default host takes priority over load
balancing; choose **Auto** in a draft's host picker to load-balance that one thread.
