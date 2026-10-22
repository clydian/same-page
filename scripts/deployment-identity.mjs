// Release verification also runs before npm ci. Keep this path policy free of
// package imports while covering Vite chunks and versioned runtime decoders.
export function isReleaseScriptPath(scriptPath) {
  scriptPath = scriptPath.replace(/^\/_releases\/[a-f0-9]{40}\//, "/");
  return /^\/assets\/[^/]+\.m?js$/.test(scriptPath)
    || /^\/pdfjs\/\d+\.\d+\.\d+\/wasm\/(?:jbig2|openjpeg)_nowasm_fallback\.js$/.test(scriptPath);
}

export function shellJavaScriptAssets(html) {
  return [...html.matchAll(/(?:src|href)="(\/(?:_releases\/[a-f0-9]{40}\/)?assets\/[^"]+\.js)"/g)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);
}
