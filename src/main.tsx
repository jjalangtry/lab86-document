import React from 'react';
import { createRoot } from 'react-dom/client';
import './browser-vault';
import App from './App';
import './style.css';

const media = matchMedia('(prefers-color-scheme: dark)');
document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
