const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// Подключение к базе
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// GET /api/menu
router.get('/', async (req, res) => {
  try {
    console.log('⏳ Получаем меню из базы...');

    const result = await pool.query('SELECT * FROM dishes');
    console.log('✅ Найдено блюд:', result.rows.length);

    const grouped = {
      burgers: [],
      sticks: [],
      combos: [],
      pizzas: [],
      rolls: [],
      extras: [],
      drinks: [],
      desserts: [],
    };

    result.rows.forEach((dish) => {
      if (grouped[dish.category]) {
        grouped[dish.category].push(dish);
      } else {
        console.warn(`⚠ Неизвестная категория: ${dish.category}`);
      }
    });

    const categories = [
      {
        title: 'Бургеры "Кат"',
        id: 'burgers',
        items: grouped.burgers.map(mapDish),
      },
      {
        title: 'Стики',
        id: 'sticks',
        items: grouped.sticks.map(mapDish),
      },
      {
        title: 'Комбо',
        id: 'combos',
        items: grouped.combos.map(mapDish),
      },
      {
        title: 'Пиццы',
        id: 'pizzas',
        items: grouped.pizzas.map(mapDish),
      },
      {
        title: 'Ролы',
        id: 'rolls',
        items: grouped.rolls.map(mapDish),
      },
      {
        title: 'Допы',
        id: 'extras',
        items: grouped.extras.map(mapDish),
      },
      {
        title: 'Напитки',
        id: 'drinks',
        items: grouped.drinks.map(mapDish),
      },
      {
        title: 'Десерты',
        id: 'desserts',
        items: grouped.desserts.map(mapDish),
      },
    ];

    return res.json({ success: true, categories });
  } catch (err) {
    console.error('❌ Ошибка при получении меню:', err);
    return res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});


// Обработка POST /api/menu
router.post('/', async (req, res) => {
  try {
    // 1. Считываем данные из req.body
    const { name, category, price, description, image_url } = req.body;

    // 2. Выполняем SQL-запрос на добавление в таблицу dishes (пример!)
    const insertQuery = `
      INSERT INTO dishes (name, category, price, description, img)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const values = [name, category, price, description, image_url];

    const result = await pool.query(insertQuery, values);

    // 3. Отправляем успешный ответ
    res.json({ 
      success: true, 
      message: 'Блюдо успешно добавлено', 
      newDishId: result.rows[0].id 
    });
  } catch (err) {
    console.error('Ошибка при добавлении блюда:', err);
    res.status(500).json({ success: false, message: 'Ошибка при добавлении блюда' });
  }
});



// Вынесем функцию преобразования одного блюда
function mapDish(d) {
  return {
    name: d.name,
    price: `${Number(d.price).toLocaleString()} сум`,
    img: d.img,
    description: d.description
  };
}

module.exports = router;
