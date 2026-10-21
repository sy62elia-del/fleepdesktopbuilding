const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const releasesFile = path.resolve(
  process.env.RELEASES_FILE || path.join(__dirname, 'releases.json')
);
const releaseDirectory = path.resolve(
  process.env.UPDATE_DIR || path.join(__dirname, '..', 'dist')
);

function isReleaseFile(name) {
  return /^latest(?:-[a-z]+)?\.yml$/i.test(name) ||
    /^[\w .+-]+\.(?:exe|blockmap|zip|dmg|appimage|deb|rpm|tar\.gz)$/i.test(name);
}

function respond(response, status, message) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  response.end(message);
}

async function serveReleaseManifest(request, response) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(releasesFile, 'utf8'));
  } catch (error) {
    console.error(`Unable to read release manifest "${releasesFile}":`, error);
    respond(response, 500, 'Unable to read release manifest');
    return;
  }

  const urlFields = ['url', 'url-win', 'url-mac', 'url-lin', 'url-bcm'];
  const releaseUrls = {};
  if (
    !manifest ||
    typeof manifest.version !== 'string' ||
    !manifest.version.trim()
  ) {
    console.error(`Invalid release manifest "${releasesFile}": expected a non-empty version`);
    respond(response, 500, 'Invalid release manifest');
    return;
  }

  for (const field of urlFields) {
    if (typeof manifest[field] !== 'string') {
      console.error(`Invalid release manifest "${releasesFile}": expected a ${field} string`);
      respond(response, 500, 'Invalid release manifest');
      return;
    }

    try {
      const releaseUrl = new URL(manifest[field]);
      if (
        releaseUrl.protocol !== 'https:' ||
        releaseUrl.username ||
        releaseUrl.password
      ) {
        throw new Error('Expected a public HTTPS URL');
      }
      releaseUrls[field] = releaseUrl.href;
    } catch (error) {
      console.error(`Invalid ${field} in release manifest "${releasesFile}":`, error);
      respond(response, 500, 'Invalid release manifest URL');
      return;
    }
  }

  const body = JSON.stringify({
    version: manifest.version.trim(),
    ...releaseUrls
  });
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache'
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    respond(response, 405, 'Method not allowed');
    return;
  }

  let filename;
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/releases.json') {
      await serveReleaseManifest(request, response);
      return;
    }
    filename = pathname.slice(1);
  } catch {
    respond(response, 400, 'Invalid request path');
    return;
  }

  if (!filename || filename !== path.basename(filename) || !isReleaseFile(filename)) {
    respond(response, 404, 'Not found');
    return;
  }

  const filePath = path.join(releaseDirectory, filename);
  try {
    const file = await fs.promises.stat(filePath);
    if (!file.isFile()) {
      respond(response, 404, 'Not found');
      return;
    }

    let start = 0;
    let end = file.size - 1;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || file.size === 0) {
        response.writeHead(416, { 'Content-Range': `bytes */${file.size}` });
        response.end();
        return;
      }

      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : end;
      } else {
        const suffixLength = Number(match[2]);
        start = Math.max(0, file.size - suffixLength);
      }

      if (start >= file.size || end < start) {
        response.writeHead(416, { 'Content-Range': `bytes */${file.size}` });
        response.end();
        return;
      }
      end = Math.min(end, file.size - 1);
    }

    response.writeHead(range ? 206 : 200, {
      'Content-Type': filename.endsWith('.yml')
        ? 'text/yaml; charset=utf-8'
        : 'application/octet-stream',
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.size}` } : {}),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': filename.endsWith('.yml')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable'
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', (error) => {
      console.error(`Unable to stream update file "${filename}":`, error);
      if (response.headersSent) response.destroy(error);
      else respond(response, 500, 'Unable to serve update file');
    });
    stream.pipe(response);
  } catch (error) {
    if (error.code === 'ENOENT') {
      respond(response, 404, 'Not found');
      return;
    }
    console.error(`Unable to read update file "${filename}":`, error);
    respond(response, 500, 'Unable to serve update file');
  }
});

server.listen(port, host, () => {
  console.log(`Fleep update files available at http://${host}:${port}/`);
  console.log(`Serving release files from ${releaseDirectory}`);
});
