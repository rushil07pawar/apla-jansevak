# Connect Supabase MCP

This project is already configured for the Supabase project `fabyzumelsiedjlrycsu` in [`.vscode/mcp.json`](.vscode/mcp.json). The configuration contains no password, service-role key, or personal access token.

## VS Code

1. Open the `apla-jansevak` folder in a current version of VS Code with MCP support enabled.
2. Reload the VS Code window after opening the project.
3. Open the MCP/AI tools panel or Command Palette and locate the server named **supabase-apla-jansevak**.
4. Start or connect the server. VS Code should open a browser window.
5. Sign in to the Supabase account that owns the AplaJansevak project and approve access to the project.
6. Return to VS Code and confirm that the server shows as connected.

If VS Code does not detect the file, verify that the workspace root is this repository and that the file is exactly `.vscode/mcp.json`, then reload the window again.

## ChatGPT

ChatGPT does **not** read the VS Code `.vscode/mcp.json` file. To connect the same server to ChatGPT:

1. In ChatGPT, open **Settings** → **Connectors**.
2. Enable developer mode if ChatGPT prompts you to do so.
3. Add a custom MCP connector with this URL:

   ```text
   https://mcp.supabase.com/mcp?project_ref=fabyzumelsiedjlrycsu&features=database%2Cdebugging%2Cdevelopment
   ```

4. Complete the Supabase browser sign-in and grant access to the organization that contains AplaJansevak.
5. Confirm the connector is connected, then return to this task and say: `Supabase MCP connected`.

## Security notes

- Do not paste a Supabase service-role key, database password, access token, Auth password, or `ADMIN_SETUP_KEY` into ChatGPT, this file, or a frontend environment variable.
- The MCP connection uses Supabase OAuth. Its project scope is limited to `fabyzumelsiedjlrycsu`.
- Connection alone does not change the database. Database inspection will occur first; promotion of `rushil07pawar@gmail.com` will happen only after the live account, setup latch, and existing administrator count are verified.

## Official reference

See the [Supabase MCP Server documentation](https://supabase.com/docs/guides/ai-tools/mcp) for current client-specific connection instructions.
