import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePilotSession } from '../../pilot/runtime';

export default function pilotSessionPost(event: {
	node: { req: IncomingMessage; res: ServerResponse };
}) {
	return handlePilotSession(event.node.req, event.node.res);
}
