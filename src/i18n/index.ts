/**
 * i18n —国际化 (i18next)
 *
 * Поддержка русского и английского.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from './locales/ru.json'
import en from './locales/en.json'

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: 'en', // язык по умолчанию
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n