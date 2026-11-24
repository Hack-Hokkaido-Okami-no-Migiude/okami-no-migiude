// Server-assigned identifiers: `<prefix>_<uuid>` per the P0 contract. Fixture
// seed ids are fixed constants owned by `server/demo`; generated ids are unique
// per assignment and never reused after a row is removed.
import { randomUUID } from 'node:crypto';

export type IdPrefix =
	| 'cli'
	| 'ses'
	| 'seg'
	| 'ans'
	| 'pkg'
	| 'prv'
	| 'qst'
	| 'asg';

export function newId(prefix: IdPrefix): string {
	return `${prefix}_${randomUUID()}`;
}
