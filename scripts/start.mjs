// Supported launch for the built server (`npm start` after `npm run build`).
// This app is a local, single-user tool: the server binds to the loopback
// interface by default so it is never reachable from the network. An operator
// can still set NITRO_HOST or HOST explicitly — plain environment variables
// work cross-platform, which a `HOST=… npm start` prefix in the npm script
// would not. The wrapper is plain Node with no dependencies: it defaults the
// host, then loads the generated Nitro entry, which honors NITRO_PORT/PORT and
// NITRO_UNIX_SOCKET.
import { existsSync } from 'node:fs';

const serverEntry = new URL('../.output/server/index.mjs', import.meta.url);
if (!existsSync(serverEntry)) {
	console.error(
		'The server build is missing at .output/server/index.mjs; run `npm run build` first.',
	);
	process.exit(1);
}
process.env.NITRO_HOST ??= process.env.HOST ?? '127.0.0.1';
await import(serverEntry.href);
