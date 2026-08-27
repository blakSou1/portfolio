# Портфолио: 3D / Шейдеры / Анимация

Статический сайт-портфолио для графических работ, хостится бесплатно на **GitHub Pages**.
Работы загружаются через git — сайт сам подхватывает их из `data/projects.json`.

## Что внутри
- Интерактивный просмотр **3D-моделей** (Three.js + OrbitControls, авто-вращение, скелетная анимация).
- Живые **шейдеры** (GLSL, запускаются прямо в браузере на WebGL).
- **Видео** и **изображения** как превью.
- Фильтр по категориям: моделирование / шейдеры / анимация / графика.
- **Скрытый раздел** — работы с `"hidden": true` не видны зрителям. Они появляются только при открытии сайта с секретным ключом:
  `https://твой-логин.github.io/проект/?key=my-secret-key-123`
- Исходники проектов (`.blend`, `.fbx`, сырые файлы) кладутся в `private/source/` и **не выдаются зрителям** — на сайте только рендер/превью.

## Структура
```
portfolio/
├── index.html
├── css/style.css
├── js/main.js          # галерея, фильтры, скрытый раздел
├── js/viewer.js        # Three.js + WebGL просмотрщики
├── data/projects.json  # манифест работ (правишь его)
├── assets/
│   ├── previews/       # картинки-превью
│   ├── models/         # .glb для интерактивного просмотра (веб-оптимизированные)
│   └── shaders/        # .frag файлы шейдеров
└── private/source/     # исходники, скрытые от зрителей
```

## Как добавить работу
Отредактируй `data/projects.json`, добавив объект в массив `projects`:

```json
{
  "id": "my-helmet",
  "title": "Мой шлем",
  "category": "modeling",
  "year": 2026,
  "description": "Описание работы.",
  "type": "model",
  "model": "assets/models/my.glb",
  "poster": "",
  "featured": false,
  "hidden": false
}
```

Типы (`type`): `model` | `shader` | `image` | `video`.
- `model` → укажи `"model": "ссылка_или_путь.glb"`.
- `shader` → укажи `"shader": "assets/shaders/name.frag"`.
- `image` → `"image": "assets/previews/x.jpg"`.
- `video` → `"video": "assets/..."`.
- `hidden: true` → работа попадёт только в скрытый раздел.

Затем:
```bash
git add .
git commit -m "add work"
git push
```

## Локальный запуск
ES-модули и `fetch` требуют http, а не `file://`. Из папки `portfolio`:
```bash
python -m http.server 8000
# открой http://localhost:8000
```

## Деплой на GitHub Pages
1. Создай репозиторий, закинь папку `portfolio`.
2. GitHub → Settings → Pages → Source: `main` / `/root`.
3. Через минуту сайт будет на `https://твой-логин.github.io/проект/`.
   Если репозиторий называется `username.github.io`, сайт будет в корне.

> Секретный ключ меняется в `data/projects.json` поле `site.secretKey`.
> Внимание: это «сокрытие от глаз», а не настоящая защита — код ключа виден в JS.
> Для реальной приватности держи исходники в приватном репозитории / облаке.
