const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const artifactsDirectory = path.join(root, 'artifacts');
const bucket = process.env.R2_BUCKET;
const accountId = process.env.R2_ACCOUNT_ID;
let publicBaseUrl = process.env.R2_PUBLIC_URL;

function required(name, value) {
  if (!value || !value.trim()) throw new Error(`Missing required environment variable ${name}`);
  return value.trim();
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) throw new Error(`Missing build artifact directory: ${directory}`);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function findOne(directory, predicate, description) {
  const matches = listFiles(directory).filter((file) => predicate(path.basename(file)));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${description} in ${directory}, found ${matches.length}`);
  }
  return matches[0];
}

function publicUrl(prefix, filePath) {
  const relativeFile = path.basename(filePath).split(path.sep).map(encodeURIComponent).join('/');
  return `${publicBaseUrl}/${prefix}/${relativeFile}`;
}

function aws(args) {
  execFileSync('aws', [...args, '--endpoint-url', endpoint, '--region', 'auto'], {
    cwd: root,
    stdio: 'inherit'
  });
}

function publishPlatform(artifactName, prefix, metadataName) {
  const source = path.join(artifactsDirectory, artifactName);
  findOne(source, (name) => name === metadataName, metadataName);

  aws([
    's3', 'sync', source, `s3://${bucket}/${prefix}/`,
    '--cache-control', 'public, max-age=31536000, immutable',
    '--exclude', 'latest*.yml'
  ]);
  aws([
    's3', 'cp', findOne(source, (name) => name === metadataName, metadataName),
    `s3://${bucket}/${prefix}/${metadataName}`,
    '--cache-control', 'no-cache',
    '--content-type', 'text/yaml'
  ]);
  return source;
}

function main() {
  required('R2_BUCKET', bucket);
  required('R2_ACCOUNT_ID', accountId);
  required('AWS_ACCESS_KEY_ID', process.env.AWS_ACCESS_KEY_ID);
  required('AWS_SECRET_ACCESS_KEY', process.env.AWS_SECRET_ACCESS_KEY);

  let publicUrlObject;
  try {
    publicUrlObject = new URL(required('R2_PUBLIC_URL', publicBaseUrl));
  } catch (error) {
    throw new Error(`R2_PUBLIC_URL must be an HTTPS URL: ${error.message}`);
  }
  if (publicUrlObject.protocol !== 'https:' || publicUrlObject.username || publicUrlObject.password) {
    throw new Error('R2_PUBLIC_URL must be a public HTTPS URL');
  }

  publicUrlObject.pathname = publicUrlObject.pathname.replace(/\/+$/, '');
  const normalizedBaseUrl = publicUrlObject.href.replace(/\/+$/, '');
  publicBaseUrl = normalizedBaseUrl;
  endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  const windows = path.join(artifactsDirectory, 'fleep-windows-x64');
  const linux = path.join(artifactsDirectory, 'fleep-linux-x64');
  const macX64 = path.join(artifactsDirectory, 'fleep-macos-x64');
  const macArm64 = path.join(artifactsDirectory, 'fleep-macos-arm64');
  const platformDirectories = [
    [windows, 'latest.yml'],
    [linux, 'latest-linux.yml'],
    [macX64, 'latest-mac.yml'],
    [macArm64, 'latest-mac.yml']
  ];
  for (const [directory, metadataName] of platformDirectories) {
    findOne(directory, (name) => name === metadataName, metadataName);
  }

  const windowsInstaller = findOne(
    windows,
    (name) => /\.exe$/i.test(name) && !/\.blockmap$/i.test(name),
    'Windows installer'
  );
  const windowsBlockmap = findOne(
    windows,
    (name) => /\.exe\.blockmap$/i.test(name),
    'Windows installer blockmap'
  );
  const macX64Package = findOne(
    macX64,
    (name) => /\.dmg$/i.test(name),
    'macOS x64 DMG'
  );
  const macArm64Package = findOne(
    macArm64,
    (name) => /\.dmg$/i.test(name),
    'macOS arm64 DMG'
  );
  const linuxPackage = findOne(
    linux,
    (name) => /\.AppImage$/i.test(name),
    'Linux AppImage'
  );

  publishPlatform('fleep-windows-x64', 'windows-x64', 'latest.yml');
  publishPlatform('fleep-linux-x64', 'linux-x64', 'latest-linux.yml');
  publishPlatform('fleep-macos-x64', 'mac-x64', 'latest-mac.yml');
  publishPlatform('fleep-macos-arm64', 'mac-arm64', 'latest-mac.yml');

  const manifest = {
    version: packageJson.version,
    url: publicUrl('windows-x64', windowsInstaller),
    'url-win': publicUrl('windows-x64', windowsInstaller),
    'url-mac': publicUrl('mac-x64', macX64Package),
    'url-mac-x64': publicUrl('mac-x64', macX64Package),
    'url-mac-arm64': publicUrl('mac-arm64', macArm64Package),
    'url-lin': publicUrl('linux-x64', linuxPackage),
    'url-bcm': publicUrl('windows-x64', windowsBlockmap)
  };
  const manifestPath = path.join(artifactsDirectory, 'releases.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  aws([
    's3', 'cp', manifestPath, `s3://${bucket}/releases.json`,
    '--cache-control', 'no-cache',
    '--content-type', 'application/json'
  ]);

  console.log(`Published Fleep ${packageJson.version} to ${normalizedBaseUrl}`);
}

let endpoint;
try {
  main();
} catch (error) {
  console.error('Cloudflare R2 release publishing failed:', error.message);
  process.exitCode = 1;
}
