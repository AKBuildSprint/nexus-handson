import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StorefrontApp } from './storefront-app';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Nexus Storefront root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <StorefrontApp />
  </StrictMode>,
);
