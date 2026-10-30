// Where the tests find the app and put their output (git ignores .test-output/).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = path.join(ROOT, 'site');
export const OUT = path.join(ROOT, '.test-output');
export const PHOTOS = path.join(OUT, 'photos');
