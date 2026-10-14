import { mount } from 'svelte';
import App from './App.svelte';
import Persistent from './Persistent.svelte';
import '../shared/webview.js';
import '../shared/appearance.js';
import '../shared/locale.js';
import '../shared/app-theme.css';
import './styles.css';
import './light.css';
import './workspace.css';

mount(new URLSearchParams(location.search).has('persistent') ? Persistent : App, { target: document.getElementById('app')! });
