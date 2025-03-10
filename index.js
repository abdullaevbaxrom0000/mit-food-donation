const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://www.mit-foodcompany.uz/"], // Разрешаем запросы с локального фронтенда и Vercel
    methods: ["GET", "POST"], // Разрешённые методы
  }
});

// Используем порт от Render или 5000 для локальной разработки
const port = process.env.PORT || 5000;

// Храним количество донатов для каждой позиции
let donations = {
  1: 20, // Всего Донаты (heart.svg)
  2: 7,  // Пицца (spizza.svg)
  3: 10, // Кола (bottle.svg)
  4: 3   // Кат бургер (gam.svg)
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Пользователь подключился');
  // Отправляем текущие значения донатов новому пользователю
  socket.emit('updateDonations', donations);

  // Обработка оплаты и увеличения донатов
  socket.on('paymentCompleted', (items) => {
    console.log('Получены items:', items); // Логируем все items
    items.forEach(item => {
      console.log('Обработка item:', item.name, ' (нижний регистр:', item.name.toLowerCase(), ')');
      const storyId = Object.keys(donations).find(id => {
        const nameLower = item.name.toLowerCase();
        if (id == 2 && nameLower.includes('пицца')) return true;
        if (id == 3 && nameLower === 'кола') return true;
        if (id == 4 && nameLower.includes('кат бургер')) return true;
        return false;
      });
      if (storyId) {
        donations[storyId] += item.quantity || 1;
        donations[1] += item.quantity || 1;
        console.log(`Увеличен storyId ${storyId} и 1 на ${item.quantity || 1}`);
      } else {
        console.log('Не найдено storyId для:', item.name, '(нижний регистр:', item.name.toLowerCase(), ')');
      }
    });
    io.emit('updateDonations', donations);
    console.log('Донаты обновлены:', donations);
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился');
  });
});

server.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});