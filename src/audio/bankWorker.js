// Rendert die Klangbank im Hintergrund-Thread und schickt jede Variante sofort zurück
import { jobList, renderJob } from './recipes.js';

self.onmessage = () => {
  const t0 = performance.now();
  for (const [name, i] of jobList()) {
    const r = renderJob(name, i);
    self.postMessage(r, [r.data.buffer]);
  }
  self.postMessage({ done: true, ms: performance.now() - t0 });
};
