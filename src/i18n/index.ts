/**
 * i18n — локализация интерфейса.
 *
 * Базовые словари содержат часть исторических/технических названий. Для
 * рабочего UI поверх них накладываем компактные пользовательские подписи,
 * чтобы интерфейс не показывал TypeText/RemapKey и не смешивал языки.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from './locales/ru.json'
import en from './locales/en.json'
import automationRu from './locales/automation.ru.json'
import automationEn from './locales/automation.en.json'

const ruTranslation = {
  ...ru,
  automation: automationRu,
  nav: {
    ...ru.nav,
    rules: 'Правила',
    layers: 'Слои',
    macros: 'Макросы',
    text: 'Текст',
    automation: automationRu.nav,
    settings: 'Настройки',
  },
  menu: {
    ...ru.menu,
    view: 'Вид',
    tools: 'Инструменты',
    profiles: 'Профили',
    clear_mappings: 'Очистить правила',
  },
  status: {
    ...ru.status,
    ready: 'Готово',
  },
  footer: {
    ...ru.footer,
    daemon_start: 'Запустить daemon',
    daemon_stop: 'Остановить daemon',
    active_profile: 'Профиль',
  },
  rules: {
    ...ru.rules,
    title: 'Правила',
    editor_title: 'Редактор правила',
    search_placeholder: 'Поиск правил',
    search_empty: 'Ничего не найдено',
    total_rules: 'Всего правил',
    select_rule_hint: 'Выберите правило слева или создайте новое',
    delete_rule: 'Удалить правило',
    confirm_delete: 'Удалить выбранное правило?',
    confirm_clear_all: 'Удалить все правила активного профиля?',
    unsaved: 'изменено',
  },
  ruleBuilder: {
    ...ru.ruleBuilder,
    tabs: {
      ...ru.ruleBuilder.tabs,
      name: 'Основные',
      trigger: 'Триггер',
      conditions: 'Условия',
      actions: 'Действия',
      tap_actions: 'Короткое нажатие',
      hold_actions: 'Удержание',
    },
    buttons: {
      ...ru.ruleBuilder.buttons,
      add_condition: 'Добавить условие',
      add_action: 'Добавить действие',
      add_hold_action: 'Добавить действие',
      save_rule: 'Сохранить',
      cancel: 'Отмена',
    },
    trigger_types: {
      ...ru.ruleBuilder.trigger_types,
      keyDown: 'Нажатие клавиши',
      keyUp: 'Отпускание клавиши',
      mouseDown: 'Нажатие кнопки мыши',
      mouseUp: 'Отпускание кнопки мыши',
      tapHoldKeyDown: 'Короткое / удержание',
      typedText: 'Ввод последовательности',
    },
    condition_types: {
      ...ru.ruleBuilder.condition_types,
      layerActive: 'Активный слой',
      windowMatch: 'Активное окно',
      virtualDesktop: 'Виртуальный рабочий стол',
    },
    action_types: {
      ...ru.ruleBuilder.action_types,
      remapKey: 'Переназначить клавишу',
      remapMouse: 'Переназначить кнопку мыши',
      typeText: 'Ввести текст',
      runMacro: 'Выполнить макрос',
      toggleLayer: 'Переключить слой',
      holdLayer: 'Удерживать слой',
      systemVolume: 'Громкость',
      mediaKey: 'Медиа-клавиша',
      windowAction: 'Действие с окном',
      launchApp: 'Запустить программу',
      focusProcess: 'Активировать окно',
      sleep: 'Сон компьютера',
      monitorOff: 'Выключить монитор',
    },
    hints: {
      ...ru.ruleBuilder.hints,
      no_conditions_global: 'Нет условий — правило работает глобально.',
      must_have_action: 'Добавьте хотя бы одно действие.',
      no_parameters: 'Без параметров',
      virtual_desktop_unsupported: 'Условие осталось от старой схемы и пока не поддерживается движком.',
    },
    priority: 'Приоритет',
    priority_hint: 'Большее значение выполняется раньше',
    unsaved_title: 'Несохранённые изменения',
    unsaved_message: 'Отбросить изменения и продолжить?',
    discard_changes: 'Отбросить',
  },
  keyPicker: {
    ...ru.keyPicker,
    none: 'Не выбрано',
  },
}

const enTranslation = {
  ...en,
  automation: automationEn,
  nav: {
    ...en.nav,
    rules: 'Rules',
    layers: 'Layers',
    macros: 'Macros',
    text: 'Text',
    automation: automationEn.nav,
    settings: 'Settings',
  },
  menu: {
    ...en.menu,
    view: 'View',
    tools: 'Tools',
    profiles: 'Profiles',
    clear_mappings: 'Clear rules',
  },
  status: {
    ...en.status,
    ready: 'Ready',
  },
  footer: {
    ...en.footer,
    daemon_start: 'Start daemon',
    daemon_stop: 'Stop daemon',
    active_profile: 'Profile',
  },
  rules: {
    ...en.rules,
    title: 'Rules',
    editor_title: 'Rule editor',
    search_placeholder: 'Search rules',
    search_empty: 'Nothing found',
    total_rules: 'Total rules',
    select_rule_hint: 'Select a rule on the left or create a new one',
    delete_rule: 'Delete rule',
    confirm_delete: 'Delete selected rule?',
    confirm_clear_all: 'Delete all rules in the active profile?',
    unsaved: 'modified',
  },
  ruleBuilder: {
    ...en.ruleBuilder,
    tabs: {
      ...en.ruleBuilder.tabs,
      name: 'General',
      trigger: 'Trigger',
      conditions: 'Conditions',
      actions: 'Actions',
      tap_actions: 'Tap',
      hold_actions: 'Hold',
    },
    buttons: {
      ...en.ruleBuilder.buttons,
      add_condition: 'Add condition',
      add_action: 'Add action',
      add_hold_action: 'Add action',
      save_rule: 'Save',
      cancel: 'Cancel',
    },
    trigger_types: {
      ...en.ruleBuilder.trigger_types,
      keyDown: 'Key press',
      keyUp: 'Key release',
      mouseDown: 'Mouse button press',
      mouseUp: 'Mouse button release',
      tapHoldKeyDown: 'Tap / hold',
      typedText: 'Typed sequence',
    },
    condition_types: {
      ...en.ruleBuilder.condition_types,
      layerActive: 'Active layer',
      windowMatch: 'Active window',
      virtualDesktop: 'Virtual desktop',
    },
    action_types: {
      ...en.ruleBuilder.action_types,
      remapKey: 'Remap key',
      remapMouse: 'Remap mouse button',
      typeText: 'Type text',
      runMacro: 'Run macro',
      toggleLayer: 'Toggle layer',
      holdLayer: 'Hold layer',
      systemVolume: 'Volume',
      mediaKey: 'Media key',
      windowAction: 'Window action',
      launchApp: 'Launch application',
      focusProcess: 'Focus window',
      sleep: 'Sleep computer',
      monitorOff: 'Turn monitor off',
    },
    hints: {
      ...en.ruleBuilder.hints,
      no_conditions_global: 'No conditions — rule is global.',
      must_have_action: 'Add at least one action.',
      no_parameters: 'No parameters',
      virtual_desktop_unsupported: 'This legacy condition is not implemented by the engine yet.',
    },
    priority: 'Priority',
    priority_hint: 'Higher values run first',
    unsaved_title: 'Unsaved changes',
    unsaved_message: 'Discard changes and continue?',
    discard_changes: 'Discard',
  },
  keyPicker: {
    ...en.keyPicker,
    none: 'Not selected',
  },
}

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ruTranslation },
    en: { translation: enTranslation },
  },
  lng: 'ru',
  fallbackLng: 'ru',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
