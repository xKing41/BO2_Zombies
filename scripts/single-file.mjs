// Erzeugt aus dem Vite-Build eine einzige, eigenständige HTML-Datei (dist/nachtfall.html):
// alle Skripte, Styles und Icons eingebettet. Ideal zum Weitergeben, für itch.io
// oder zum Öffnen ohne Server.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const file = (p) => readFileSync(join(dist, p.replace(/^\.\//, '')));

// Styles einbetten
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g, (_, href) => `<style>${file(href).toString()}</style>`);

// Modul-Skript einbetten (ans Ende des Body, damit das DOM bereit ist)
let js = '';
html = html.replace(/<script type="module"[^>]*src="([^"]+\.js)"[^>]*><\/script>\s*/g, (_, src) => { js += file(src).toString(); return ''; });
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
// Ersetzungsfunktion statt Text: $-Folgen im Bundle dürfen nicht interpretiert werden
html = html.replace('</body>', () => `<script type="module">${js}</script>\n</body>`);

// Icons als data-URI, Manifest entfernen (eine Einzeldatei ist keine installierbare App)
const icon = (p) => (existsSync(join(dist, p)) ? 'data:image/png;base64,' + file(p).toString('base64') : '');
html = html.replace('href="./icons/icon-192.png"', `href="${icon('icons/icon-192.png')}"`);
html = html.replace('href="./icons/apple-touch-icon.png"', `href="${icon('icons/apple-touch-icon.png')}"`);
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');

writeFileSync(join(dist, 'nachtfall.html'), html);
console.log(`dist/nachtfall.html geschrieben (${(html.length / 1024).toFixed(0)} KB)`);
