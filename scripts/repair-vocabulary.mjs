import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/data/vocabulary.json';
let source = readFileSync(path, 'utf8');

source = source
  .replace(/即"([^"\\]*(?:\\.[^"\\]*)*)"。/g, '即\\"$1\\"。')
  .replace(/即"([^"\\]*(?:\\.[^"\\]*)*)"，/g, '即\\"$1\\"，');

JSON.parse(source);
writeFileSync(path, source, 'utf8');
