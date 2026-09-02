import { ensurePdfJsUint8Polyfills } from './pdfjs-polyfill.js';
import './style.css';
import { Parsers } from './parsers.js';
import { Categorizer } from './categorizer.js';
import { ImportTimeline } from './import-timeline.js';
import { applyChartTheme } from './format.js';
import { initTheme, toggleTheme } from './theme.js';
import { initApp, syncSearch, refreshForTheme } from './app.js';
import { ensureAuth } from './auth.js';
import { setupSidebar } from './sidebar.js';

ensurePdfJsUint8Polyfills();

window.Parsers = Parsers;
window.Categorizer = Categorizer;
window.ImportTimeline = ImportTimeline;

initTheme();
applyChartTheme();
setupSidebar();

ensureAuth(async () => {
  await initApp();
});

window.syncSearch = syncSearch;
window.toggleAppTheme = () => {
  toggleTheme();
  applyChartTheme();
  refreshForTheme();
};
