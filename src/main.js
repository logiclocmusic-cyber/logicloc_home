import './style.css';
import { Parsers } from './parsers.js';
import { Categorizer } from './categorizer.js';
import { ImportTimeline } from './import-timeline.js';
import { initApp, syncSearch } from './app.js';
import { ensureAuth } from './auth.js';
import { setupSidebar } from './sidebar.js';

window.Parsers = Parsers;
window.Categorizer = Categorizer;
window.ImportTimeline = ImportTimeline;

setupSidebar();

ensureAuth(async () => {
  await initApp();
});

window.syncSearch = syncSearch;
