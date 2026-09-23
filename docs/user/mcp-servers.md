# MCP servers

Tangent can give every agent the same extra MCP servers, such as an executor server, without
configuring each provider's CLI. Add them in **Settings → Providers → MCP servers**.

Each server needs a name and a streamable HTTP URL. Add headers if the server needs them, for
example `Authorization`. Header values are stored in the server's secret store and are never shown
again; leave a saved value blank to keep it.

Servers belong to the environment you are viewing. Each machine has its own list, and a URL such
as `http://127.0.0.1:4788/mcp` points at that machine. To use a server everywhere, add it on each
environment.

Every provider gets the server unless you untick it in the server's **Providers** list. Use the
switch to turn a server off for all providers. Changes apply to sessions that start afterwards, so
restart a thread's session to pick them up.

Hermes and Pi don't support shared MCP servers yet. Tools from these servers aren't pre-approved,
so they follow your permission mode like any other tool.
