require('dotenv').config();
const querystring = require('querystring');
const { Pool } = require('pg');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const cookieParser = require('cookie-parser'); // Для парсинга cookies

const app = express();

// Настройка CORS для Express
app.use(cors({
  origin: ['http://localhost:3000', 'https://www.mit-foodcompany.uz'],
  methods: ['GET', 'POST'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json());
app.use(cookieParser());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://www.mit-foodcompany.uz"],
    methods: ["GET", "POST"],
    credentials: true,
    transports: ['websocket', 'polling']
  }
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log('Подключение к базе установлено'))
  .catch(err => console.error('Ошибка подключения к базе:', err));

// Храним донаты в памяти
let donations = {};

// 1. Создание таблицы донатов (без изменений)
async function createDonationsTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS donations (
      donationId SERIAL PRIMARY KEY,
      count INT NOT NULL DEFAULT 0
    );
  `;
  await pool.query(createTableQuery);

  const checkRows = await pool.query('SELECT donationId FROM donations');
  if (checkRows.rows.length === 0) {
    const insertDefaults = `
      INSERT INTO donations (donationId, count)
      VALUES (1, 20), (2, 7), (3, 10), (4, 3)
      ON CONFLICT (donationId) DO UPDATE SET count = EXCLUDED.count;
    `;
    await pool.query(insertDefaults);
    console.log('Вставлены начальные данные по донатам.');
  } else {
    console.log('Таблица donations уже содержит данные.');
  }
}

// 2. Новая схема таблицы sessions: id SERIAL PRIMARY KEY, sessionToken UNIQUE
async function createSessionsTable() {
  // Если вы уже создали старую таблицу, придётся дропнуть вручную.
  // Здесь мы просто создаём таблицу, если её нет.
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      sessionToken VARCHAR(255) UNIQUE NOT NULL,
      userId VARCHAR(255) NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      isActive BOOLEAN DEFAULT TRUE
    );
  `;
  await pool.query(createTableQuery);
  console.log('Таблица sessions создана или уже существует.');
}

// 3. Загрузка донатов из базы
async function loadDonationsFromDB() {
  const result = await pool.query('SELECT donationId, count FROM donations');
  const temp = {};
  result.rows.forEach(row => {
    const id = parseInt(row.donationid, 10);
    const cnt = row.count;
    if (!isNaN(id) && cnt !== undefined) {
      temp[id] = cnt;
    } else {
      console.error('Некорректный donationid или count:', row);
    }
  });
  donations = temp;
  console.log('Донаты загружены из БД:', donations);

  if (Object.keys(donations).length === 0) {
    await createDonationsTable();
    await loadDonationsFromDB();
    console.log('Принудительная инициализация данных выполнена.');
  }
}

// 4. Обновление донатов в базе
async function updateDonationInDB(donationId, incrementValue) {
  await pool.query(
    'UPDATE donations SET count = count + $1 WHERE donationId = $2',
    [incrementValue, donationId]
  );
}

// Инициализация базы при старте
(async () => {
  try {
    await createDonationsTable();
    await createSessionsTable(); // <-- Новая схема sessions
    await loadDonationsFromDB();
  } catch (err) {
    console.error('Ошибка при инициализации базы:', err);
  }
})();

// Отдаём index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.io для донатов
io.on('connection', (socket) => {
  console.log('Пользователь подключился');
  socket.emit('updateDonations', donations);

  socket.on('paymentCompleted', async (items) => {
    if (!Array.isArray(items)) {
      console.log('Ошибка: items должен быть массивом');
      return;
    }
    console.log('Получены items:', items);

    for (const item of items) {
      if (!item || !item.name || typeof item.quantity !== 'number') {
        console.log('Ошибка: неверный формат item:', item);
        continue;
      }
      const storyId = Object.keys(donations).find(id => {
        const numId = parseInt(id, 10);
        const nameLower = item.name.toLowerCase();
        if (numId === 2 && nameLower.includes('пицца')) return true;
        if (numId === 3 && nameLower === 'кола') return true;
        if (numId === 4 && (nameLower.includes('кат бургер') || nameLower.includes('двойной кат'))) return true;
        return false;
      });

      if (storyId) {
        const qty = item.quantity || 1;
        donations[storyId] += qty;
        donations[1] += qty;
        console.log(`Увеличен storyId ${storyId} и 1 на ${qty}`);

        try {
          await updateDonationInDB(parseInt(storyId, 10), qty);
          await updateDonationInDB(1, qty);
        } catch (err) {
          console.error('Ошибка обновления донатов в БД:', err);
          await loadDonationsFromDB();
        }
      } else {
        console.log('Не найдено storyId для:', item.name);
      }
    }
    io.emit('updateDonations', donations);
    console.log('Донаты обновлены:', donations);
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился');
  });
});

// Эндпоинт Telegram Login
app.post('/api/telegram-login', async (req, res) => {
  const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ success: false, message: 'Токен бота не настроен' });
  }

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const dataCheckString = Object.keys(req.body)
    .filter(key => key !== 'hash')
    .sort()
    .map(key => `${key}=${req.body[key]}`)
    .join('\n');

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    return res.status(400).json({ success: false, message: 'Неверная подпись' });
  }

  const authDateNum = parseInt(auth_date, 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDateNum > 24 * 60 * 60) {
    return res.status(400).json({ success: false, message: 'Сессия истекла' });
  }

  // Генерируем случайный токен (крайне маловероятно, но возможна коллизия)
  const sessionToken = crypto.randomBytes(16).toString('hex');

  try {
    // Проверяем, есть ли активная сессия для userId
    const existingSession = await pool.query(
      'SELECT id, sessionToken, isActive FROM sessions WHERE userId = $1 AND isActive = TRUE',
      [id]
    );

    if (existingSession.rows.length > 0) {
      // Обновляем существующую запись
      await pool.query(
        'UPDATE sessions SET sessionToken = $1 WHERE userId = $2 AND isActive = TRUE',
        [sessionToken, id]
      );
      console.log('Сессия обновлена:', { sessionToken, userId: id });
    } else {
      // Удаляем все старые записи для userId
      await pool.query('DELETE FROM sessions WHERE userId = $1', [id]);
      console.log('Все сессии удалены для userId:', id);

      // Вставляем новую
      await pool.query(
        'INSERT INTO sessions (sessionToken, userId, isActive) VALUES ($1, $2, TRUE)',
        [sessionToken, id]
      );
      console.log('Сессия сохранена:', { sessionToken, userId: id });
    }
  } catch (err) {
    console.error('Ошибка при сохранении сессии:', err);
    return res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
  }

  // Устанавливаем куку
  res.cookie('sessionToken', sessionToken, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'none',
    secure: true,
    domain: '.mit-foodcompany.uz'
  });
  res.json({ success: true, message: 'Авторизация успешна' });
});


// Эндпоинт Google Login
app.post('/api/google-login', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ success: false, message: 'Нет данных от Google' });
  }

  // Здесь нужно декодировать и проверить credential с помощью Google API
  // Для этого нужен пакет `google-auth-library`
  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); // Добавь GOOGLE_CLIENT_ID в .env
  let payload;

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID, // Должен совпадать с Client ID из Google Console
    });
    payload = ticket.getPayload();
  } catch (error) {
    console.error('Ошибка проверки Google токена:', error);
    return res.status(400).json({ success: false, message: 'Неверный токен Google' });
  }

  const { sub: userId, email, name, picture } = payload;

  // Генерируем случайный sessionToken
  const sessionToken = crypto.randomBytes(16).toString('hex');

  try {
    // Проверяем, есть ли активная сессия для userId
    const existingSession = await pool.query(
      'SELECT id, sessionToken, isActive FROM sessions WHERE userId = $1 AND isActive = TRUE',
      [userId]
    );

    if (existingSession.rows.length > 0) {
      // Обновляем существующую запись
      await pool.query(
        'UPDATE sessions SET sessionToken = $1 WHERE userId = $2 AND isActive = TRUE',
        [sessionToken, userId]
      );
      console.log('Сессия обновлена:', { sessionToken, userId });
    } else {
      // Удаляем все старые записи для userId
      await pool.query('DELETE FROM sessions WHERE userId = $1', [userId]);
      console.log('Все сессии удалены для userId:', userId);

      // Вставляем новую
      await pool.query(
        'INSERT INTO sessions (sessionToken, userId, isActive) VALUES ($1, $2, TRUE)',
        [sessionToken, userId]
      );
      console.log('Сессия сохранена:', { sessionToken, userId });
    }
  } catch (err) {
    console.error('Ошибка при сохранении сессии:', err);
    return res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
  }

  // Устанавливаем куку
  res.cookie('sessionToken', sessionToken, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
    sameSite: 'none',
    secure: true,
    domain: '.mit-foodcompany.uz'
  });
  res.json({ success: true, message: 'Авторизация через Google успешна' });
});


// Эндпоинт logout
app.post('/api/logout', async (req, res) => {
  console.log('Выход: обработка запроса /api/logout'); // Добавь эту строку
  console.log('Cookies получены:', req.cookies);
  const sessionToken = req.cookies.sessionToken;

  if (!sessionToken) {
    return res.status(400).json({ success: false, message: 'Нет активной сессии' });
  }

  try {
    const result = await pool.query(
      'UPDATE sessions SET isActive = FALSE WHERE sessionToken = $1 RETURNING *',
      [sessionToken]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ success: false, message: 'Сессия не найдена' });
    }

    // Очищаем куку
    res.clearCookie('sessionToken', {
      sameSite: 'none',
      secure: true,
      domain: '.mit-foodcompany.uz'
    });
    res.json({ success: true, message: 'Выход выполнен успешно' });
  } catch (err) {
    console.error('Ошибка при выходе:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

const port = process.env.PORT || 10000;
server.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});

// Отключаемся от базы при SIGTERM
process.on('SIGTERM', async () => {
  console.log('Завершение работы сервера...');
  await pool.end();
  console.log('Соединение с базой закрыто.');
  process.exit(0);
});
