# Device-local MCP acceptance

Use the existing Electron test profile and test service. Keep the synthetic DXF and request traces on the device.

## Setup and regression

1. Open Skills → Add → Local MCP (this device). Test a nonexistent executable. Verify that the form reports a connection failure and that Save stays disabled.
2. Enter the installed OpenCADStudio executable with `--mcp` and a synthetic marker in the environment. Test the connection, select only `ocs_inspect`, and save. Verify the active tool count.
3. Quit and relaunch the same Electron profile with the synthetic DXF open in OpenCADStudio. Verify the saved connection. Start a new Agent chat using this device, invoke `ocs_inspect`, and check the tool card for the active document and filename.
4. Inspect the test service request paths and model request payloads during installation and invocation. The executable, argument, and synthetic marker should be absent. The model request can contain the selected tool schema and tool output. Expect no cloud connector creation, sync, or invocation. Electron's DevTools HAR export can omit `app://` requests. Inspect their Payload tab and, if needed, capture only marker matches and request paths at the desktop proxy boundary.
5. Disable the local connection and start a new local Agent chat. Confirm that the local tool is omitted and an existing builtin tool still runs. Confirm that the legacy Add custom MCP skill form still shows Streamable HTTP and its connection test. The Web client should omit the device-local option.

## CAD editing

1. In a disposable DXF with equipment blocks, a main aisle and several water circuits, move one grinder in the OpenCADStudio editor. Save the working copy. For the synthetic millimeter layout, move G-001 from (2400, 2900) to (3000, 2900), leaving its water inlet unconnected by 600 mm.
2. In the Electron test chat, enable `ocs_inspect`, `ocs_read`, `ocs_execute`, and `ocs_save_verified`. Ask the Agent to read the current revision, locate the moved machine, check the aisle and determine the water gap. Check the returned drawing data against the working copy.
3. Ask the Agent to update only the affected polyline endpoint using the current document revision and expected old coordinate. Read back that edit, then save a verified DXF R2010 to a fresh filename.
4. Reopen the revised DXF. Compare all equipment positions and unaffected layers against the working copy. The edited endpoint should meet the equipment port, the aisle should stay clear, and the working copy should remain available.

## Local and server routing regressions

- Edit the tool selection of a saved connection. Reopen the form and check the selection and count. Try malformed environment JSON and a valid JSON value that is not a string map. Confirm both produce an environment-specific error before any process starts.
- If a connection disappears while its settings are open, use the stale row once. Verify that the dialog reports the missing connection, refreshes the list and clears the stale tool selection.
- If saving an edited tool selection returns a temporary unavailable error, confirm the selection stays visible and can be retried.
- Add a disposable local MCP that exposes `inspect_active_drawing_geometry`. Start a new local Agent conversation and regenerate its answer after an actual call. Verify the tool is invoked on both runs and that the UI shows its real API name. Test a continued run with no incoming execution context using the streaming executor regression.
- Call an installed server MCP from the same Electron profile. In Network, verify the server request and its successful result. In a local-only turn, compare the model request's tool definitions and confirm the local executable, arguments and environment marker are absent.
- Check that disabling or removing a local server rejects new calls while an accepted tool call finishes on its original connection. The controller test uses a real stdio fixture and verifies that parallel first calls initialize one client.

## Setup initiated by a chat

1. In a signed-in desktop Agent chat using this device, ask the Agent to configure OpenCADStudio. It should open device-only setup with the preset and detect a standard macOS installation. The user tests the connection and confirms the allowed tools.
2. Confirm the configuration is shown in the existing Skills → Local MCP dialog. Send another message in the same chat and invoke an enabled CAD tool. Restart the same application profile and repeat the read.
3. Ask to configure another local MCP server. The Agent should open an empty local form. Close it and verify the tool result says setup was cancelled. Check that the browser and nonlocal or tools-disabled sessions omit the setup tool.
4. Compare Network payloads for local setup and a server MCP turn. Conversation messages and safe tool results use the existing test service. The model sees the setup preset and receipt, while the executable, arguments and environment entered into the dialog stay on the device.
5. Close chat setup while a slow connection test is running. Verify that the dialog closes and the chat gets a cancellation receipt. With one setup already open, a second chat call should return an already-open receipt. Skills and chat should share one dialog at a time.
6. Stop generation while setup is open before confirming Save. Verify that the tool call is aborted. A confirmed Save that finishes after Stop should still report what was saved.

## Recovery and account isolation

- Start a harmless read through a running device-local connection. Stop only its test stdio process and request another read without restarting Electron. If an edit was in progress when the connection closed, read the current state before retrying the edit.
- In chat setup, confirm the text describes result sharing. Choose multiple tools and test the connection again. The selection should retain the tools still advertised by the same program.
- Stop the chat while a user-confirmed Save is in flight. Check the device list and completion receipt against the actual save result.
- Switch to another authorized test account or sign out. The previous account's connections should be unavailable. Return to the first account and confirm its saved connections remain available.
- In the same app and test profile, call public tools from an installed market MCP and a separate custom Streamable HTTP MCP. Verify the selected tool source in the tool cards and confirm both requests stay on the server MCP path.
- For confidential CAD, use an approved device-side bridge with anonymized outputs. Inspect a tool result request for an anonymous receipt and compare the local saved drawing to the input separately.
