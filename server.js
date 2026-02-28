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

// 🔒 VASTE GAME ID
const MANUAL_GAME_ID = "EFTEL-123456";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: true
}));

// ✅ FIX: game bestaat altijd
let currentGame = {
    id: MANUAL_GAME_ID,
    players: [],
    scores: {}
};

io.on("connection", (socket) => {
    console.log("Nieuwe gebruiker verbonden");

    socket.emit("phaseUpdate", "lobby");
});

const allowedNames = [
    "Jestin",
    "Luca",
    "Jules",
    "Levi",
    "Bink",
    "Symen"
];

/* -------- LOGIN -------- */

app.get("/", (req, res) => {
    res.redirect("/host-login");
});

app.get("/host-login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "host-login.html"));
});

app.post("/host-login", (req, res) => {
    const password = (req.body.password || "").trim();

    if (password === DASHBOARD_PASSWORD) {
        req.session.loggedIn = true;
        return res.redirect("/host");
    }

    res.send("❌ Ongeldig wachtwoord");
});

/* -------- HOST -------- */

app.get("/host", (req, res) => {
    if (!req.session.loggedIn) {
        return res.redirect("/host-login");
    }
    res.sendFile(path.join(__dirname, "public", "host.html"));
});

/* -------- START GAME -------- */

app.post("/start-game", (req, res) => {
    if (!req.session.loggedIn) {
        return res.status(403).send("Niet toegestaan");
    }

    // ✅ FIX: reset alleen inhoud, niet null maken
    currentGame.players = [];
    currentGame.scores = {};

    res.json({
        gameId: MANUAL_GAME_ID,
        playerUrl: "/player"
    });
});

/* -------- PLAYER -------- */

app.get("/player", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "player-step1.html"));
});

/* -------- JOIN -------- */

app.post("/join", (req, res) => {

    const { name, gameId, character } = req.body;

    console.log("JOIN REQUEST:", req.body);

    /* ===============================
       GAME ID CHECK
    ===============================*/

    if (gameId !== currentGame.id) {
        return res.status(400).json({
            error: "Ongeldige Game ID"
        });
    }

    /* ===============================
       NAAM CHECK (WHITELIST)
    ===============================*/

    if (!allowedNames.includes(name)) {
        return res.status(403).json({
            error: "Deze naam is niet toegestaan!"
        });
    }

    /* ===============================
       ❌ DUBBELE NAAM BLOKKEREN
    ===============================*/

    const existingPlayer = currentGame.players.find(
        p => p.name.toLowerCase() === name.toLowerCase()
    );

    if (existingPlayer) {

        // Als dezelfde speler terugkomt → update character
        existingPlayer.character = character;

        io.emit("phaseUpdate", "lobby");

        return res.json({ success: true });
    }

    // Als iemand anders al die naam gebruikt (extra veilige check)
    const nameUsed = currentGame.players.some(
        p => p.name.toLowerCase() === name.toLowerCase()
    );

    if (nameUsed) {
        return res.status(400).json({
            error: "Deze naam is al in gebruik!"
        });
    }

    /* ===============================
       ❌ PERSONAGE CHECK
    ===============================*/

    const characterTaken = currentGame.players.find(
        p => p.character === character
    );

    if (characterTaken) {
        return res.status(400).json({
            error: "Dit personage is al gekozen!"
        });
    }

    /* ===============================
       ✅ PLAYER TOEVOEGEN
    ===============================*/

    currentGame.players.push({
        name,
        character
    });

    currentGame.scores[name] = 0;

    io.emit("phaseUpdate", "lobby");

    res.json({ success: true });
});
/* -------- LEADERBOARD -------- */

app.get("/leaderboard", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "leaderboard.html"));
});

app.get("/scores", (req, res) => {
    res.json(currentGame.scores);
});

/* -------- SCORES FULL -------- */

app.get("/scores-full", (req, res) => {
    res.json({
        gameId: currentGame.id,
        scores: currentGame.scores,
        players: currentGame.players
    });
});

/* -------- RESET GAME -------- */

app.post("/reset-game", (req, res) => {
    if (!req.session.loggedIn) {
        return res.status(403).send("Niet toegestaan");
    }

    // ✅ FIX: geen null meer
    currentGame.players = [];
    currentGame.scores = {};

    res.json({ success: true });
});

/* -------- SERVER -------- */

server.listen(PORT, () => {
    console.log("Server draait op poort " + PORT);
});



