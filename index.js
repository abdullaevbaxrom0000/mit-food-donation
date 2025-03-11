require('dotenv').config(); // Для чтения переменных окружения (DATABASE_URL)
const { Pool } = require('pg'); // Для работы с PostgreSQL
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Настройка Express и Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://www.mit-foodcompany.uz"],
    methods: ["GET", "POST"],
    credentials: true,
    transports: ['websocket', 'polling']
  }
});

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Для Render
  }
});

// Проверка подключения к базе (для отладки)
pool.connect()
  .then(() => console.log('Подключение к базе установлено'))
  .catch(err => console.error('Ошибка подключения к базе:', err));

// Переменная для хранения донатов в памяти
let donations = {};

// Функция для создания таблицы донатов
async function createDonationsTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS donations (
      donationId SERIAL PRIMARY KEY,
      count INT NOT NULL
    );
  `;
  await pool.query(createTableQuery);

  // Проверяем, есть ли записи
  const checkRows = await pool.query('SELECT donationId FROM donations');
  if (checkRows.rows.length === 0) {
    // Если записей нет, вставляем начальные значения
    const insertDefaults = `
      INSERT INTO donations (donationId, count) 
      VALUES (1, 20), (2, 7), (3, 10), (4, 3)
      ON CONFLICT (donationId) DO NOTHING;
    `;
    await pool.query(insertDefaults);
    console.log('Вставлены начальные данные по донатам.');
  } else {
    console.log('Таблица donations уже содержит данные.');
  }
}

// Функция для загрузки донатов из базы в память
async function loadDonationsFromDB() {
  const result = await pool.query('SELECT donationId, count FROM donations');
  const temp = {};
  result.rows.forEach(row => {
    const id = parseInt(row.donationId, 10); // Парсим donationId как целое число
    if (!isNaN(id)) {
      temp[id] = row.count;
    } else {
      console.warn('Некорректный donationId:', row.donationId);
    }
  });
  donations = temp;
  console.log('Донаты загружены из БД:', donations);
}

// Функция для обновления донатов в базе
async function updateDonationInDB(donationId, incrementValue) {
  await pool.query(
    'UPDATE donations SET count = count + $1 WHERE donationId = $2',
    [incrementValue, donationId]
  );
}

// Инициализация при старте: создаём таблицу и загружаем данные
(async () => {
  try {
    await createDonationsTable();
    await loadDonationsFromDB();
  } catch (err) {
    console.error('Ошибка при инициализации базы:', err);
  }
})();

// Настройка маршрута для отдачи index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Обработка событий Socket.io
io.on('connection', (socket) => {
  console.log('Пользователь подключился');

  // Отправляем актуальные данные новому клиенту
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
        const numId = parseInt(id, 10); // Преобразуем id в число
        const nameLower = item.name.toLowerCase();
        if (numId === 2 && nameLower.includes('пицца')) return true;
        if (numId === 3 && nameLower === 'кола') return true;
        if (numId === 4 && (nameLower.includes('кат бургер') || nameLower.includes('двойной кат'))) return true;
        return false;
      });

      if (storyId) {
        const qty = item.quantity || 1;

        // Обновляем в памяти
        donations[storyId] += qty;
        donations[1] += qty;

        console.log(`Увеличен storyId ${storyId} и 1 на ${qty}`);

        // Обновляем в базе
        try {
          await updateDonationInDB(parseInt(storyId, 10), qty);
          await updateDonationInDB(1, qty);
        } catch (err) {
          console.error('Ошибка обновления донатов в БД:', err);
          // Синхронизируем данные из базы, если произошла ошибка
          await loadDonationsFromDB();
        }
      } else {
        console.log('Не найдено storyId для:', item.name);
      }
    }

    // Отправляем обновлённые данные всем клиентам
    io.emit('updateDonations', donations);
    console.log('Донаты обновлены:', donations);
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился');
  });
});

// Запуск сервера
const port = process.env.PORT || 10000; // Убедимся, что порт совпадает с настройками Render
server.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});

// Graceful shutdown для закрытия пула соединений
process.on('SIGTERM', async () => {
  console.log('Завершение работы сервера...');
  await pool.end();
  console.log('Соединение с базой закрыто.');
  process.exit(0);
});