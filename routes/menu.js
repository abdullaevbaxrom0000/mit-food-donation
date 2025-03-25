const express = require("express");
const { Pool } = require("pg");


const router = express.Router();

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // переменная окружения Render
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

module.exports = router;

