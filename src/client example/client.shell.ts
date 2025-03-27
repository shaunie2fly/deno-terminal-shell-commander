// ../../../../pnprecipies/pnp/src/shell/client.shell.ts
// Import the new wrapper class instead of the base ShellClient
import { InteractiveShellClient } from '../remote/InteractiveClient.ts';
import { ClientEvent } from '../remote/protocol.ts';

console.log('Starting Interactive Remote Shell Client...');

// Use the InteractiveShellClient wrapper
const interactiveClient = new InteractiveShellClient({ host: 'localhost', port: 8080, auth: { username: 'user', password: 'pass' } });

// --- Optional: Listen to forwarded events ---
interactiveClient.on(ClientEvent.CONNECT, (payload) => {
	console.log('[InteractiveClient] Forwarded CONNECT event:', payload);
});

interactiveClient.on(ClientEvent.DISCONNECT, (payload) => {
	console.log('[InteractiveClient] Forwarded DISCONNECT event:', payload);
	// The InteractiveShellClient handles raw mode cleanup internally.
	// This handler could perform additional app-specific cleanup if needed.
	Deno.exit(0); // Exit the script when disconnected
});

interactiveClient.on(ClientEvent.ERROR, (payload) => {
	console.error('[InteractiveClient] Forwarded ERROR event:', payload);
	// Consider if the application should exit on certain errors
});

// --- Start the Interactive Client ---
(async () => {
	try {
		await interactiveClient.start(); // This handles connect, raw mode, and piping
		console.log('[InteractiveClient] Session started. Type commands or Ctrl+C / exit to quit.');
	} catch (error) {
		console.error('[InteractiveClient] Failed to start session:', error);
		Deno.exit(1);
	}
	// The script will now stay alive due to the active connection and internal piping.
	// SIGINT and unload listeners within InteractiveShellClient handle cleanup.
})();
