const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const DASHBOARD_PASSWORD = "1234";
const MANUAL_GAME_ID = "EFTEL-123456";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: true
}));

let currentGame = {
    id: MANUAL_GAME_ID,
    players: [],
    scores: {}
};

const allowedNames = [
    "Jestin",
    "Luca",
    "Jules",
    "Levi",
    "Bink",
    "Symen"
];

/* LOGIN */

app.get("/", (req, res) => {
    res.redirect("/host-login.html");
});

/* PLAYER ROUTES */

app.get("/player", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "player-step1.html"));
});

/* JOIN */

app.post("/join", (req, res) => {

    const { name, gameId, character, playerId } = req.body;

    if (gameId !== MANUAL_GAME_ID) {
        return res.status(400).json({ error: "Ongeldige Game ID" });
    }

    if (!allowedNames.includes(name)) {
        return res.status(400).json({ error: "Naam niet toegestaan" });
    }

    const existing = currentGame.players.find(
        p => p.name.toLowerCase() === name.toLowerCase()
    );

    if (existing) {
        if (existing.playerId !== playerId) {
            return res.status(400).json({ error: "Naam al in gebruik!" });
        }
        existing.character = character;
    } else {
        currentGame.players.push({
            name,
            character,
            playerId
        });
        currentGame.scores[name] = 0;
    }

    io.emit("gameUpdate", currentGame);
    res.json({ success: true });
});

/* SCORES */

app.get("/scores-full", (req, res) => {
    res.json(currentGame);
});

/* RESET */

app.post("/reset-game", (req, res) => {
    currentGame.players = [];
    currentGame.scores = {};
    io.emit("gameUpdate", currentGame);
    res.json({ success: true });
});

/* SOCKET */

io.on("connection", (socket) => {
    socket.emit("gameUpdate", currentGame);
});

/* START SERVER */

server.listen(PORT, () => {
    console.log("Server draait op poort " + PORT);
});
