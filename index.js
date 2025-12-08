// toxdo-server/index.js
import express from "express";
import cors from "cors";

const app = express();
const PORT = 3001;

// Permitir conexiones desde cualquier lugar (vital para el celular)
app.use(cors());
app.use(express.json());

// --- ENDPOINT 1: BUSCADOR DE TEXTO (SearchTab) ---
app.get("/beneficios/nearby", (req, res) => {
  const { q } = req.query;
  console.log(`🔎 Buscando: "${q}"`);

  const items = [
    {
      id: "search_1",
      title: `Resultado para "${q}"`,
      subtitle: "Encontrado por ToXdo AI",
      image: "https://via.placeholder.com/150/0b1523/ffffff?text=AI",
      badge: "Nuevo"
    },
    {
      id: "search_2",
      title: "Sushi Express",
      subtitle: "A 500m de tu ubicación",
      image: "https://via.placeholder.com/150/darkred/ffffff?text=Sushi",
      badge: "-20%"
    }
  ];

  res.json({ items });
});

// --- ENDPOINT 2: MAPA INTELIGENTE (ToXdoTab) ---
app.get("/ai/events-near", (req, res) => {
  const { lat, lng } = req.query;
  console.log(`📍 Pidiendo mapa en: ${lat}, ${lng}`);

  // Convertimos a números para calcular coordenadas cercanas
  const latitude = parseFloat(lat) || -33.0;
  const longitude = parseFloat(lng) || -71.5;

  const realEvents = [
    {
      id: "map_1",
      title: "Sunset Jazz",
      place: "Terraza Hotel Sheraton",
      category: "concierto",
      lat: latitude + 0.002,
      lng: longitude + 0.002,
      distance: "200 m",
      time: "Hoy 19:30"
    },
    {
      id: "map_2",
      title: "Feria Gastronómica",
      place: "Plaza Principal",
      category: "comida",
      lat: latitude - 0.002,
      lng: longitude + 0.001,
      distance: "500 m",
      time: "Hasta 23:00"
    },
    {
      id: "map_3",
      title: "Museo Abierto",
      place: "Centro Cultural",
      category: "arte",
      lat: latitude + 0.001,
      lng: longitude - 0.003,
      distance: "1.2 km",
      time: "Gratis hoy"
    }
  ];

  // Simulamos un pequeño delay de "pensamiento"
  setTimeout(() => {
    res.json({ items: realEvents });
  }, 500);
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SERVIDOR LISTO!`);
  console.log(`📡 Escuchando en: http://localhost:${PORT}`);
  console.log(`🌍 Prueba en celular usando tu IP (ej: http://192.168.101.4:${PORT})`);
});