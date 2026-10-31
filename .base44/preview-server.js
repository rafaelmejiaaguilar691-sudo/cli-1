#!/usr/bin/env node
// Base44 preview server for the npm CLI docs workspace.
//
// The npm CLI itself has no web server, so the preview serves the repo's own
// documentation site (built from docs/lib/content by `npm run build -w docs`)
// from docs/output. Section landing pages come from docs/lib/content/nav.yml,
// so nothing here is hand-written product copy.
//
// Usage: node .base44/preview-server.js   (PORT defaults to 3000)
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('yaml')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'docs', 'output')
const NAV_FILE = path.join(ROOT, 'docs', 'lib', 'content', 'nav.yml')
const { version } = require(path.join(ROOT, 'package.json'))

const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
})[char])

const layout = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body {
  background-color: #ffffff;
  color: #24292e;
  margin: 0;
  line-height: 1.5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
#rainbar {
  height: 10px;
  background-image: linear-gradient(139deg, #fb8817, #ff4b01, #c12127, #e02aff);
}
main {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 4rem;
}
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
h2 a { color: #24292e; }
p.lead { color: #6a737d; margin: 0 0 1rem; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: .45rem 0; border-bottom: 1px solid #eaecef; }
li a { color: #0366d6; text-decoration: none; }
li a:hover { text-decoration: underline; }
li .desc { display: block; color: #6a737d; font-size: .85rem; }
footer { margin-top: 2.5rem; color: #6a737d; font-size: .8rem; }
footer code { background: #f6f8fa; padding: .1rem .3rem; border-radius: 3px; }
</style>
</head>
<body>
<div id="rainbar"></div>
<main>
${body}
<footer>npm CLI <code>v${escapeHtml(version)}</code> documentation, built from this repository by <code>npm run build -w docs</code>.</footer>
</main>
</body>
</html>`

const readNav = () => {
  const parsed = yaml.parse(fs.readFileSync(NAV_FILE, 'utf8'))
  return Array.isArray(parsed) ? parsed : []
}

const docList = (children = []) => `<ul>
${children.map((child) => `  <li><a href="${escapeHtml(child.url)}">${escapeHtml(child.title)}</a>${
    child.description ? `\n    <span class="desc">${escapeHtml(child.description)}</span>` : ''
  }</li>`).join('\n')}
</ul>`

const indexPage = () => {
  const nav = readNav()
  return layout('npm CLI documentation', `<h1>npm CLI documentation</h1>
<p class="lead">Every page below is generated from the markdown in <code>docs/lib/content</code>.</p>
${nav.map((section) => `<h2><a href="${escapeHtml(section.url)}">${escapeHtml(section.title)}</a></h2>
${docList(section.children)}`).join('\n')}`)
}

const sectionPage = (section) => layout(`${section.title} - npm CLI documentation`, `
<h1><a href="/">npm CLI documentation</a></h1>
<h2>${escapeHtml(section.title)}</h2>
${docList(section.children)}`)

const notFoundPage = (pathname) => layout('Not found - npm CLI documentation', `
<h1>Page not found</h1>
<p class="lead"><code>${escapeHtml(pathname)}</code> is not part of the generated docs.</p>
<p><a href="/">Back to the docs index</a></p>`)

const send = (res, status, body, type = 'text/html; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

const serveFile = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  })
  fs.createReadStream(filePath).pipe(res)
}

const isFile = (filePath) => {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

const server = http.createServer((req, res) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    return send(res, 400, layout('Bad request', '<h1>Bad request</h1>'))
  }

  const cleanup = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname

  try {
    if (cleanup === '/' || cleanup === '/index.html') {
      return send(res, 200, indexPage())
    }

    const section = readNav().find((entry) => entry.url === cleanup)
    if (section) {
      return send(res, 200, sectionPage(section))
    }

    const relative = path.normalize(cleanup).replace(/^(\.\.[/\\])+/, '')
    const target = path.join(OUTPUT, relative)
    if (!target.startsWith(OUTPUT)) {
      return send(res, 403, layout('Forbidden', '<h1>Forbidden</h1>'))
    }
    if (isFile(target)) {
      return serveFile(res, target)
    }
    if (isFile(`${target}.html`)) {
      return serveFile(res, `${target}.html`)
    }
    if (isFile(path.join(target, 'index.html'))) {
      return serveFile(res, path.join(target, 'index.html'))
    }
  } catch (err) {
    process.stderr.write(`preview-server error: ${err.stack}\n`)
    return send(res, 500, layout('Error', '<h1>The docs preview failed to render this page</h1>'))
  }

  send(res, 404, notFoundPage(cleanup))
})

server.listen(PORT, HOST, () => {
  process.stderr.write(`docs preview listening on http://${HOST}:${PORT}\n`)
})
