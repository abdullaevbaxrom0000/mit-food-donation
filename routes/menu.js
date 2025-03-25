const express = require("express");
const router = express.Router();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

router.get("/menu", async (req, res) => {
  try {
    const dishesFromDB = await pool.query("SELECT * FROM dishes");

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

    dishesFromDB.rows.forEach((dish) => {
      if (grouped[dish.category]) {
        grouped[dish.category].push(dish);
      }
    });

    const categories = [
      {
        title: 'Бургеры "Кат"',
        id: "burgers",
        items: grouped.burgers.map((d) => ({
          name: d.name,
          price: `${d.price.toLocaleString()} сум`,
          img: d.img,
          description: d.description,
        })),
      },
      {
        title: "Стики",
        id: "sticks",
        items: grouped.sticks.map((d) => ({
          name: d.name,
          price: `${d.price.toLocaleString()} сум`,
          img: d.img,
          description: d.description,
        })),
      },
      {
        title: "Комбо",
        id: "combos",
        items: grouped.combos.map((d) => ({
          name: d.name,
          price: `${d.price.toLocaleString()} сум`,
          img: d.img,
          description: d.description,
        })),
      },
      {
        title: "Пиццы",
        id: "pizzas",
        items: grouped.pizzas.map((d) => ({
          name: d.name,
          price: `${d.price.toLocaleString()} сум`,
          img: d.img,
          description: d.description,
        })),
      },
      {
        title: "Ролы",
        id: "rolls",
        items: grouped.rolls.map((d) => ({
          name: d.name,
          price: `${d.price.toLocaleString()} сум`,
          img: d.img,
          description: d.description,
        })),
      },
      {
        title: "Допы",
        id: "extras",
        items: grouped.extras.map((d) => ({
          name: d.name,
          price: `${d.price.toLocaleString()} сум`,
          img: d.img,
          description: d.description,
        })),
      },
      {
        title: "Напитки",
        id: "drinks",
        items: grouped.drinks.map((d) => ({
          name: d.name,
          price: `${d.price.toLocaleString()} сум`,
          img: d.img,
          description: d.description,
        })),
      },
      {
        title: "Десерты",
        id: "desserts",
        items: grouped.desserts.map((d) => ({
          name: d.name,
          price: `${d.price.toLocaleString()} сум`,
          img: d.img,
          description: d.description,
        })),
      },
    ];

    res.json({ success: true, categories });
  } catch (err) {
    console.error("Ошибка при получении меню:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

module.exports = router;
