import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductionConsoleApp } from './production-console-app';
import './styles/design-tokens.css';
import './styles/console-layout.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Nexus Console root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ProductionConsoleApp />
  </StrictMode>,
);
