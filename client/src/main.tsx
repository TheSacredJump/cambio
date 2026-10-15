import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BACK_SVG, GRAIN } from './art';
import './styles.css';

document.documentElement.style.setProperty('--back', BACK_SVG);
document.documentElement.style.setProperty('--grain', GRAIN);

createRoot(document.getElementById('root')!).render(<App />);
