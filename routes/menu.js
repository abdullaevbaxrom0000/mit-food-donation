const express = require("express");
const { Pool } = require("pg");

const router = express.Router();

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// GET /api/menu — список всех блюд
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM menu_items ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка при получении меню:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ✅ POST /api/menu — добавление блюда
router.post("/", async (req, res) => {
  const { name, category, price, description, image_url } = req.body;

  if (!name || !category || !price) {
    return res.status(400).json({ error: "Обязательные поля отсутствуют" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO menu_items (name, category, price, description, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, category, price, description, image_url]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка при добавлении блюда:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

module.exports = router;
