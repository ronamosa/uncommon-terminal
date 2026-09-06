/**
 * Keeps manifest.json and versions.json in step with package.json.
 * Run through `npm version`, which sets the package version first.
 */
import { readFileSync, writeFileSync } from 'fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = version;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[version] = manifest.minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');

console.log(`Set version ${version} (minAppVersion ${manifest.minAppVersion})`);
