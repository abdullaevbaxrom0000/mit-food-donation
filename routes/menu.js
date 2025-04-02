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
    console.log("⏳ Загружаем меню и категории...");

    // Сначала получаем список категорий
    const catResult = await pool.query('SELECT id, title FROM categories ORDER BY title');

    // Готовим структуру под каждую категорию
    const grouped = {};
    catResult.rows.forEach((cat) => {
      grouped[cat.id] = {
        id: cat.id,
        title: cat.title,
        items: [],
      };
    });

    // Потом получаем блюда
    const dishResult = await pool.query('SELECT * FROM dishes');

    // Добавляем блюда в соответствующие категории
    dishResult.rows.forEach((dish) => {
      if (grouped[dish.category]) {
        grouped[dish.category].items.push(mapDish(dish));
      } else {
        console.warn(`⚠ Неизвестная категория: ${dish.category}`);
      }
    });

    // Преобразуем объект в массив
    const categories = Object.values(grouped);

    console.log("✅ Категорий:", categories.length);
    res.json({ success: true, categories });
  } catch (err) {
    console.error("❌ Ошибка при получении меню:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
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


// Обновление блюда по ID
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, price, image_url, category } = req.body;

  try {
    const result = await pool.query(
      `UPDATE dishes 
       SET name = $1, description = $2, price = $3, img = $4, category = $5 
       WHERE id = $6 
       RETURNING *`,
      [name, description, price, image_url, category, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Блюдо не найдено" });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка при обновлении блюда:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
});




// Вынесем функцию преобразования одного блюда
function mapDish(d) {
  return {
    id: d.id,
    name: d.name,
    price: `${Number(d.price).toLocaleString()} сум`,
    img: d.img,
    description: d.description
  };
}




// DELETE /api/menu/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM dishes WHERE id = $1 RETURNING *', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Блюдо не найдено' });
    }

    res.status(200).json({ success: true, message: 'Блюдо удалено' });
  } catch (err) {
    console.error('Ошибка при удалении блюда:', err);
    res.status(500).json({ success: false, message: 'Ошибка при удалении блюда' });
  }
});



// Получить список всех категорий
router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title FROM categories ORDER BY title');
    res.status(200).json({ success: true, categories: result.rows });
  } catch (err) {
    console.error('Ошибка при получении категорий:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});




// Добавить новую категорию
router.post('/categories', async (req, res) => {
  const { id, title } = req.body;

  if (!id || !title) {
    return res.status(400).json({ success: false, message: 'id и title обязательны' });
  }

  try {
    await pool.query(
      'INSERT INTO categories (id, title) VALUES ($1, $2)',
      [id, title]
    );

    res.status(201).json({ success: true, message: 'Категория добавлена' });
  } catch (err) {
    console.error('Ошибка при добавлении категории:', err);
    res.status(500).json({ success: false, message: 'Ошибка при добавлении категории' });
  }
});





// Удалить категорию
router.delete('/categories/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Категория не найдена' });
    }

    res.status(200).json({ success: true, message: 'Категория удалена' });
  } catch (err) {
    console.error('Ошибка при удалении категории:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Обновить категорию
router.put('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  try {
    const result = await pool.query(
      'UPDATE categories SET title = $1 WHERE id = $2 RETURNING *',
      [title, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Категория не найдена' });
    }

    res.status(200).json({ success: true, message: 'Категория обновлена', category: result.rows[0] });
  } catch (err) {
    console.error('Ошибка при обновлении категории:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});




module.exports = router;