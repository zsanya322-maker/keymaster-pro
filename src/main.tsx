/**
 * Entry point — подключает i18n, рендерит App
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './i18n' // инициализация i18next
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)