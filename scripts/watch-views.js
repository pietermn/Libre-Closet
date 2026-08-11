/* Restart Nest's existing TypeScript watcher after a Handlebars template changes. */
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');

const views = path.resolve(__dirname, '..', 'views', '**', '*.hbs');
const restartSignal = path.resolve(__dirname, '..', 'src', 'main.ts');
let debounceTimer;

chokidar.watch(views, { ignoreInitial: true }).on('all', (_event, file) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    fs.utimesSync(restartSignal, new Date(), new Date());
    console.log(`[views] changed ${path.relative(process.cwd(), file)} — restarting Nest`);
  }, 75);
});
