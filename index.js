require('dotenv').config();
const querystring = require('querystring');
const { Pool } = require('pg');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const app = express();

// Настройка CORS для Express
app.use(cors({
  origin: ['http://localhost:3000', 'https://www.mit-foodcompany.uz'],
  methods: ['GET', 'POST'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

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

// Настройка пула соединений с параметрами
let pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20, // Максимальное количество соединений
  idleTimeoutMillis: 30000, // Время простоя перед закрытием (30 секунд)
  connectionTimeoutMillis: 5000, // Таймаут на установку соединения (5 секунд)
});

// Обработка ошибок пула
pool.on('error', (err, client) => {
  console.error('Ошибка в пуле соединений:', err.stack);
});

// Функция проверки и восстановления соединения
async function ensureConnection() {
  try {
    await pool.query('SELECT 1');
    console.log('Соединение с базой активно');
  } catch (err) {
    console.error('Соединение с базой потеряно, пытаемся переподключиться:', err.stack);
    try {
      await pool.end();
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      pool.on('error', (err, client) => {
        console.error('Ошибка в новом пуле соединений:', err.stack);
      });
      console.log('Переподключение успешно');
    } catch (reconnectErr) {
      console.error('Не удалось переподключиться:', reconnectErr.stack);
    }
  }
}

// Проверяем соединение при старте и каждые 5 минут
ensureConnection();
setInterval(ensureConnection, 5 * 60 * 1000);

// Функция для запросов с повторными попытками
async function queryWithRetry(query, params, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await pool.query(query, params);
    } catch (err) {
      console.error(`Ошибка запроса (попытка ${i + 1}/${retries}):`, err.stack);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Храним донаты в памяти
let donations = {};

// 1. Создание таблицы донатов
async function createDonationsTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS donations (
      donationId SERIAL PRIMARY KEY,
      count INT NOT NULL DEFAULT 0
    );
  `;
  await queryWithRetry(createTableQuery, []);

  const checkRows = await queryWithRetry('SELECT donationId FROM donations', []);
  if (checkRows.rows.length === 0) {
    const insertDefaults = `
      INSERT INTO donations (donationId, count)
      VALUES (1, 20), (2, 7), (3, 10), (4, 3)
      ON CONFLICT (donationId) DO UPDATE SET count = EXCLUDED.count;
    `;
    await queryWithRetry(insertDefaults, []);
    console.log('Вставлены начальные данные по донатам.');
  } else {
    console.log('Таблица donations уже содержит данные.');
  }
}

// 2. Создание таблицы sessions
async function createSessionsTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      sessionToken VARCHAR(255) UNIQUE NOT NULL,
      userId VARCHAR(255) NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      isActive BOOLEAN DEFAULT TRUE
    );
  `;
  await queryWithRetry(createTableQuery, []);
  console.log('Таблица sessions создана или уже существует.');
}

// 3. Создание таблицы users
async function createUsersTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      userId VARCHAR(255) PRIMARY KEY,
      username VARCHAR(255),
      email VARCHAR(255),
      phone VARCHAR(20),
      level VARCHAR(50) DEFAULT 'Стартер',
      total_cashback FLOAT DEFAULT 0,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await queryWithRetry(createTableQuery, []);
  console.log('Таблица users создана или уже существует.');
}

// 4. Создание таблицы cashback_history
async function createCashbackHistoryTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS cashback_history (
      id SERIAL PRIMARY KEY,
      userId VARCHAR(255) REFERENCES users(userId),
      orderId VARCHAR(255),
      orderAmount FLOAT NOT NULL,
      cashbackAmount FLOAT NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await queryWithRetry(createTableQuery, []);
  console.log('Таблица cashback_history создана или уже существует.');
}

// 5. Загрузка донатов из базы
async function loadDonationsFromDB() {
  const result = await queryWithRetry('SELECT donationId, count FROM donations', []);
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

// 6. Обновление донатов в базе
async function updateDonationInDB(donationId, incrementValue) {
  await queryWithRetry(
    'UPDATE donations SET count = count + $1 WHERE donationId = $2',
    [incrementValue, donationId]
  );
}

// Инициализация базы при старте
(async () => {
  try {
    await createDonationsTable();
    await createSessionsTable();
    await createUsersTable();
    await createCashbackHistoryTable();
    await loadDonationsFromDB();
  } catch (err) {
    console.error('Ошибка при инициализации базы:', err);
  }
})();

// Эндпоинт для пинга (чтобы сервер не "засыпал")
app.get('/ping', (req, res) => {
  res.status(200).send('Server is alive');
});

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

  try {
    const userCheck = await queryWithRetry('SELECT * FROM users WHERE userId = $1', [id]);
    if (userCheck.rows.length === 0) {
      await queryWithRetry(
        'INSERT INTO users (userId, username, phone) VALUES ($1, $2, $3)',
        [id, username || `${first_name} ${last_name}`, '+998991234567']
      );
      console.log('Пользователь добавлен в таблицу users:', { userId: id, username: username || `${first_name} ${last_name}` });
    } else {
      console.log('Пользователь уже существует:', { userId: id });
    }
  } catch (err) {
    console.error('Ошибка при сохранении пользователя:', err);
    return res.status(500).json({ success: false, message: 'Ошибка при сохранении пользователя' });
  }

  const sessionToken = crypto.randomBytes(16).toString('hex');

  try {
    const existingSession = await queryWithRetry(
      'SELECT id, sessionToken, isActive FROM sessions WHERE userId = $1 AND isActive = TRUE',
      [id]
    );

    if (existingSession.rows.length > 0) {
      await queryWithRetry(
        'UPDATE sessions SET sessionToken = $1 WHERE userId = $2 AND isActive = TRUE',
        [sessionToken, id]
      );
      console.log('Сессия обновлена:', { sessionToken, userId: id });
    } else {
      await queryWithRetry('DELETE FROM sessions WHERE userId = $1', [id]);
      console.log('Все сессии удалены для userId:', id);

      await queryWithRetry(
        'INSERT INTO sessions (sessionToken, userId, isActive) VALUES ($1, $2, TRUE)',
        [sessionToken, id]
      );
      console.log('Сессия сохранена:', { sessionToken, userId: id });
    }
  } catch (err) {
    console.error('Ошибка при сохранении сессии:', err);
    return res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
  }

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

  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  let payload;

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    console.error('Ошибка проверки Google токена:', error);
    return res.status(400).json({ success: false, message: 'Неверный токен Google' });
  }

  const { sub: userId, email, name, picture } = payload;

  try {
    const userCheck = await queryWithRetry('SELECT * FROM users WHERE userId = $1', [userId]);
    if (userCheck.rows.length === 0) {
      await queryWithRetry(
        'INSERT INTO users (userId, username, email) VALUES ($1, $2, $3)',
        [userId, name, email]
      );
      console.log('Пользователь добавлен в таблицу users:', { userId, username: name });
    } else {
      console.log('Пользователь уже существует:', { userId });
    }
  } catch (err) {
    console.error('Ошибка при сохранении пользователя:', err);
    return res.status(500).json({ success: false, message: 'Ошибка при сохранении пользователя' });
  }

  const sessionToken = crypto.randomBytes(16).toString('hex');

  try {
    const existingSession = await queryWithRetry(
      'SELECT id, sessionToken, isActive FROM sessions WHERE userId = $1 AND isActive = TRUE',
      [userId]
    );

    if (existingSession.rows.length > 0) {
      await queryWithRetry(
        'UPDATE sessions SET sessionToken = $1 WHERE userId = $2 AND isActive = TRUE',
        [sessionToken, userId]
      );
      console.log('Сессия обновлена:', { sessionToken, userId });
    } else {
      await queryWithRetry('DELETE FROM sessions WHERE userId = $1 AND isActive = FALSE', [userId]);
      console.log('Все сессии удалены для userId:', userId);

      await queryWithRetry(
        'INSERT INTO sessions (sessionToken, userId, isActive) VALUES ($1, $2, TRUE)',
        [sessionToken, userId]
      );
      console.log('Сессия сохранена:', { sessionToken, userId });
    }
  } catch (err) {
    console.error('Ошибка при сохранении сессии:', err);
    return res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
  }

  res.cookie('sessionToken', sessionToken, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'none',
    secure: true,
    domain: '.mit-foodcompany.uz'
  });
  res.json({ success: true, message: 'Авторизация через Google успешна' });
});

// Эндпоинт logout
app.post('/api/logout', async (req, res) => {
  console.log('Выход: обработка запроса /api/logout');
  console.log('Cookies получены:', req.cookies);
  const sessionToken = req.cookies.sessionToken;

  if (!sessionToken) {
    return res.status(400).json({ success: false, message: 'Нет активной сессии' });
  }

  try {
    const result = await queryWithRetry(
      'UPDATE sessions SET isActive = FALSE WHERE sessionToken = $1 RETURNING *',
      [sessionToken]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ success: false, message: 'Сессия не найдена' });
    }

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

// Эндпоинт для создания заказа и начисления кэшбэка
app.post('/api/create-order', async (req, res) => {
  console.log("req.body в create-order:", req.body);

  const { orderAmount, orderName } = req.body;
  const sessionToken = req.cookies.sessionToken;

  if (!sessionToken) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }

  if (!orderAmount || orderAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Некорректная сумма заказа' });
  }

  try {
    const session = await queryWithRetry(
      'SELECT userId FROM sessions WHERE sessionToken = $1 AND isActive = TRUE',
      [sessionToken]
    );

    if (session.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Сессия недействительна' });
    }

    const userId = session.rows[0].userid;

    const user = await queryWithRetry('SELECT level FROM users WHERE userId = $1', [userId]);
    if (user.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const userLevel = user.rows[0].level;
    const cashbackRate = userLevel === 'Стартер' ? 0.05 : 0.10;
    const cashbackAmount = orderAmount * cashbackRate;

    const orderId = crypto.randomBytes(8).toString('hex');

    await queryWithRetry(
      'INSERT INTO cashback_history (userId, orderId, orderAmount, cashbackAmount, "orderName") VALUES ($1, $2, $3, $4, $5)',
      [userId, orderId, orderAmount, cashbackAmount, orderName]
    );

    await queryWithRetry(
      'UPDATE users SET total_cashback = total_cashback + $1 WHERE userId = $2',
      [cashbackAmount, userId]
    );

    console.log('Заказ создан, кэшбэк начислен:', { userId, orderId, orderAmount, cashbackAmount, orderName });

    res.json({ success: true, message: 'Заказ создан, кэшбэк начислен', cashbackAmount });
  } catch (err) {
    console.error('Ошибка при создании заказа:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
  }
});

// Эндпоинт для получения данных пользователя (включая кэшбэк)
app.get('/api/user', async (req, res) => {
  const sessionToken = req.cookies.sessionToken;

  if (!sessionToken) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }

  try {
    const session = await queryWithRetry(
      'SELECT userId FROM sessions WHERE sessionToken = $1 AND isActive = TRUE',
      [sessionToken]
    );

    if (session.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Сессия недействительна' });
    }

    const userId = session.rows[0].userid;

    const user = await queryWithRetry(
      'SELECT username, email, phone, level, total_cashback FROM users WHERE userId = $1',
      [userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    res.json({
      success: true,
      username: user.rows[0].username,
      email: user.rows[0].email,
      phone: user.rows[0].phone,
      level: user.rows[0].level,
      total_cashback: user.rows[0].total_cashback,
    });
  } catch (err) {
    console.error('Ошибка при получении данных пользователя:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
  }
});

// Эндпоинт для получения истории кэшбэка
app.get('/api/cashback/history', async (req, res) => {
  const sessionToken = req.cookies.sessionToken;

  if (!sessionToken) {
    return res.status(401).json({ success: false, message: 'Не авторизован' });
  }

  try {
    const session = await queryWithRetry(
      'SELECT userId FROM sessions WHERE sessionToken = $1 AND isActive = TRUE',
      [sessionToken]
    );

    if (session.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Сессия недействительна' });
    }

    const userId = session.rows[0].userid;

    const history = await queryWithRetry(
      'SELECT id, orderId AS "orderId", "orderName" AS "orderName", orderAmount AS "orderAmount", cashbackAmount AS "cashbackAmount", createdat AS "createdAt", userid FROM cashback_history WHERE userId = $1 ORDER BY "createdAt" DESC',
      [userId]
    );

    console.log("История кешбэка из БД:", history.rows);

    res.json({
      success: true,
      history: history.rows,
    });
  } catch (err) {
    console.error('Ошибка при получении истории кэшбэка:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера: ' + err.message });
  }
});

// Эндпоинт для проверки статуса авторизации
app.get('/api/check-auth', async (req, res) => {
  const sessionToken = req.cookies.sessionToken;

  if (!sessionToken) {
    return res.json({ isAuthenticated: false });
  }

  try {
    const result = await queryWithRetry(
      'SELECT * FROM sessions WHERE sessionToken = $1 AND isActive = TRUE',
      [sessionToken]
    );

    if (result.rows.length > 0) {
      res.json({ isAuthenticated: true });
    } else {
      res.json({ isAuthenticated: false });
    }
  } catch (err) {
    console.error('Ошибка при проверке сессии:', err);
    res.status(500).json({ isAuthenticated: false, message: 'Ошибка сервера' });
  }
});

// Эндпоинт для получения донатов (заменяем захардкоженные данные на данные из БД)
app.get("/api/get-donations", async (req, res) => {
  try {
    await loadDonationsFromDB(); // Обновляем данные из БД
    res.json(donations);
  } catch (err) {
    console.error('Ошибка при получении донатов:', err);
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