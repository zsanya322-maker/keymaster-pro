<!-- 🇷🇺 Русский | 🇬🇧 [English](README.md) -->

<div align="center">

# ⌨️ KeyMaster Pro

**Переназначение клавиатуры и мыши, макросы, слои и текстовые расширения для Windows**

[![Лицензия: FCL](https://img.shields.io/badge/Лицензия-FCL-blue.svg)](LICENSE)
[![Платформа: Windows](https://img.shields.io/badge/Платформа-Windows%2010%2F11-0078D4.svg)](https://github.com/zsanya322-maker/keymaster-pro)
[![Стабильная версия](https://img.shields.io/badge/stable-v0.2.4-2f855a.svg)](https://github.com/zsanya322-maker/keymaster-pro/releases/latest)
[![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131.svg)](https://v2.tauri.app)

[📥 Скачать](#скачать) · [✅ Что работает](#что-работает-в-v024) · [🗺️ План](ROADMAP.md) · [📝 История изменений](CHANGELOG.md) · [🐛 Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)

</div>

---

## Что такое KeyMaster Pro?

KeyMaster Pro — настольная Windows-утилита для переназначения и автоматизации ввода, построенная вокруг единой модели правил:

```text
ТРИГГЕР + УСЛОВИЯ -> ДЕЙСТВИЯ
```

Правило может реагировать на клавишу, поддерживаемую кнопку мыши, Tap-Hold или набранную текстовую последовательность. Условия ограничивают правило активным слоем или текущим окном. Действия могут переназначать ввод, печатать текст, запускать записанный макрос, управлять слоями, окнами, медиа/системными действиями, запускать или фокусировать приложение.

Низкоуровневые Windows-хуки и выполнение правил работают в отдельном **Rust-daemon**, а GUI на **Tauri + React** отвечает за профили, правила и настройки. GUI и daemon общаются через Named Pipes / JSON-RPC.

> **Правило документации:** этот README описывает только реально работающую стабильную версию. Будущие и частично реализованные возможности находятся в [`ROADMAP.md`](ROADMAP.md).

---

## Что работает в v0.2.4

### Триггеры

- **Key Down / Key Up** — один Windows virtual-key code на один триггер.
- **Mouse Button Down / Up** — Left, Right, Middle, X1 и X2.
- **Tap-Hold** — отдельные действия на короткое нажатие и удержание, таймаут задаётся для правила.
- **Typed Text** — статическое совпадение по введённой аббревиатуре/последовательности.

### Условия

- **Layer Active**.
- **Window Match** по имени процесса и/или части заголовка активного окна.
  - Если в текущем формате заполнены оба поля, используется логика **OR / ЛЮБОЕ совпадение**.

### Действия

- переназначение клавиши;
- переназначение поддерживаемой кнопки мыши;
- ввод текста;
- запуск записанного keyboard/mouse макроса;
- toggle/hold слоя;
- mute / громкость вверх / вниз;
- play/pause/next/previous/stop;
- snap/minimize/maximize/close окна;
- запуск приложения;
- фокус окна по процессу или заголовку;
- сон ПК и отключение монитора.

### Макросы

- запись клавиатуры и мыши;
- шаги движения мыши и вертикального скролла;
- сохранение задержки для каждого шага;
- опциональный возврат курсора после макроса;
- воспроизведение макросов идёт в отдельной очереди/worker, поэтому длинный `Delay` макроса **не блокирует обычные быстрые remap-команды**.

### Слои и профили

- toggle и hold слои;
- условие `Layer Active` для правил;
- создание, сохранение/переименование, удаление, импорт, экспорт и ручное переключение профилей;
- безопасное хранение профилей/config с версией схемы, миграциями, backup, atomic write и recovery повреждённых файлов.

### Само приложение

- компактная classic-style Windows-оболочка и inline-редактор правила;
- русский и английский интерфейс;
- светлая и тёмная темы;
- системный трей и автозапуск Windows;
- встроенное подписанное обновление через GitHub Releases;
- защита несохранённого черновика правила при навигации, выходе, рестарте и обновлении;
- single-instance GUI и усиленный lifecycle/IPC daemon.

---

## Важные ограничения текущей версии

Следующие пункты **запланированы, но не являются готовыми функциями v0.2.4**:

- полноценные комбинации модификаторов вроде `Ctrl + Shift + F2`;
- переназначение комбинации в комбинацию, например `Ctrl+Shift+F2 -> Alt+Tab`;
- полный удобный каталог Windows VK и picker для него;
- wheel / horizontal wheel / double-click как триггеры правила;
- скорость макроса, repeat N, repeat while-held, cancel/emergency-stop и тестовый playback из редактора;
- автоматическое переключение профиля по приложению и режим Manual Lock;
- Virtual Desktop matching;
- date/time/clipboard переменные, delimiters и undo в Text Expansion;
- папки/группы/дерево для большого списка правил.

### Совместимость Virtual Desktop

Тип `VirtualDesktop` пока остаётся в сериализуемой схеме, чтобы старые/импортированные профили можно было прочитать, но реального runtime-matcher ещё нет. В обычном редакторе это условие нельзя создать заново. Legacy-условия Virtual Desktop компилируются **fail-closed** — они не превращаются в глобальные правила и не должны срабатывать на любом рабочем столе.

Подробный порядок реализации, изменения модели данных, миграции и критерии готовности находятся в [`ROADMAP.md`](ROADMAP.md).

---

## Архитектура

```text
┌──────────────────────────────┐
│ GUI: Tauri + React/TypeScript│
│ правила, профили, настройки │
└──────────────┬───────────────┘
               │ Named Pipes / JSON-RPC
┌──────────────▼───────────────┐
│ Rust daemon                  │
│ compiler + engine + context  │
└───────────┬─────────┬────────┘
            │         │
       keyboard     mouse
       LL hook       LL hook
            │         │
       immediate   macro worker
       simulator   (Delay отдельно)
```

Архитектурные гарантии, которые нужно сохранять после v0.2.4:

- только один daemon владеет Named Pipe и input engines;
- неподдерживаемые условия не должны fail-open;
- low-level hook callback не выполняет медленный file/network I/O;
- задержки макросов не блокируют immediate-remap очередь;
- миграции профилей/config неразрушающие и отклоняют неподдерживаемую future-schema.

---

## Скачать

### Установщик — основной вариант

Откройте [**GitHub Releases**](https://github.com/zsanya322-maker/keymaster-pro/releases/latest) и скачайте:

```text
KeyMaster-Pro_<version>_x64-setup.exe
```

После установки приложение умеет обновляться само через встроенный подписанный updater.

### MSI

К публичным релизам также прикладывается x64 MSI.

### WinGet

В репозитории есть workflow публикации WinGet. Если пакет доступен в используемом WinGet source, ID пакета:

```powershell
winget install KeyMasterPro.KeyMasterPro
```

### Portable

Нормальный публичный portable ZIP ещё в плане. Standalone-файлы из dev/checkpoint сборок пока **не считаются стабильным portable-дистрибутивом**.

---

## Сборка из исходников

### Нужно

- Windows 10/11 x64;
- рекомендуется Node.js 22;
- pnpm 9+;
- актуальный stable Rust toolchain под MSVC;
- Visual Studio Build Tools с C++ build tools.

### Запуск разработки

```powershell
git clone https://github.com/zsanya322-maker/keymaster-pro.git
cd keymaster-pro
pnpm install
pnpm tauri dev
```

Production build:

```powershell
pnpm tauri build
```

Windows bundles появляются в:

```text
src-tauri/target/release/bundle/
```

Проверки, которые используются для release candidate:

```powershell
pnpm build
pnpm lint
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## Стек

| Слой | Технология |
|---|---|
| Backend / desktop shell | Rust + Tauri v2 |
| Frontend | React 19 + TypeScript + Vite 6 |
| UI | Tailwind CSS 4 + Lucide |
| State | Zustand |
| i18n | i18next (RU + EN) |
| Input hooks | `SetWindowsHookEx` (`WH_KEYBOARD_LL`, `WH_MOUSE_LL`) через windows-rs |
| Контекст | foreground-window WinEvent hook |
| IPC | Named Pipes + JSON-RPC 2.0 |
| Хранение | локальные JSON профилей/config |

---

## Приватность и обработка ввода

Для переназначения KeyMaster Pro использует низкоуровневые keyboard/mouse hooks. Те же Win32 API могут использовать кейлоггеры, поэтому security software иногда может относиться к таким приложениям подозрительно.

Проект рассчитан на обработку событий ввода в памяти для matching/remapping и не предназначен для сохранения истории нажатий. Профили и настройки хранятся локально в JSON; встроенный updater обращается к GitHub Releases для проверки/загрузки обновлений.

Из-за low-level input interception и synthetic input возможны ложные срабатывания антивирусов. При необходимости исходники и release artifacts можно проверить самостоятельно.

---

## План разработки

Единый актуальный план находится в [`ROADMAP.md`](ROADMAP.md). Ближайшая последовательность core-completion:

- **0.3.0** — modifier/key combinations, rule-model v2, полный key picker, фундамент дерева правил;
- **0.3.1** — мышиные триггеры и завершение macro playback/control;
- **0.3.2** — профили, auto-switch/manual lock, расширенный context matching, Virtual Desktop;
- **0.3.3** — завершение Text Expansion;
- **0.4.0** — Leader Keys, Sequences, обычные-key Chords и Mouse Gestures.

Rhai scripting, browser automation, plugins, cloud sync, AI и marketplace сознательно отложены до завершения и стабилизации основного input model.

---

## Разработка / баги

- Баги: [GitHub Issues](https://github.com/zsanya322-maker/keymaster-pro/issues)
- План: [`ROADMAP.md`](ROADMAP.md)
- Что уже выпущено: [`CHANGELOG.md`](CHANGELOG.md)
- Telegram: [@KeyM_Pro](https://t.me/KeyM_Pro)

Если изменение затрагивает правила или профили, оно считается завершённым только когда согласованы **schema + migration + compiler/runtime + UI + tests**. Одна новая кнопка в интерфейсе не означает готовую функцию.

---

## Лицензия

KeyMaster Pro распространяется по **Fair Core License (FCL)**. Точные условия и дата перехода лицензии указаны в [`LICENSE`](LICENSE).
