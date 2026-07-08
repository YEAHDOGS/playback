import { addMessages, init, locale } from 'svelte-i18n';
import en from '../locales/en.json';
import es from '../locales/es.json';

// Add messages for registered languages
addMessages('en', en);
addMessages('es', es);

// Initialize i18n
init({
  fallbackLocale: 'en',
  initialLocale: 'en'
});

export { locale };
export { t } from 'svelte-i18n';
