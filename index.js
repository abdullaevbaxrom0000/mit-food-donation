const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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

const port = process.env.PORT || 5000;

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
  socket.emit('updateDonations', donations);

  socket.on('paymentCompleted', (items) => {
    if (!Array.isArray(items)) {
      console.log('Ошибка: items должен быть массивом');
      return;
    }
    console.log('Получены items:', items);
    items.forEach(item => {
      if (!item || !item.name || typeof item.quantity !== 'number') {
        console.log('Ошибка: неверный формат item:', item);
        return;
      }
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
        console.log('Не найдено storyId для:', item.name);
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