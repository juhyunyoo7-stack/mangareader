import { render } from 'preact';
import { App } from './app/App.tsx';
import { initRouter } from './app/router.ts';
import { registerServiceWorker } from './app/pwa.ts';
import './app/styles/tokens.css';
import './app/styles/base.css';

import { locale } from './strings.ts';

document.documentElement.lang = locale;
initRouter();
render(<App />, document.getElementById('app')!);
registerServiceWorker();
