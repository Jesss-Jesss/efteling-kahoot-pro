const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 10000;
let quizStarted = false;

const DASHBOARD_PASSWORD = "1234";

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: true
}));


let currentGame = {
    id: null,
    players: [],
    scores: {}
};

io.on("connection", (socket) => {
    console.log("Nieuwe gebruiker verbonden");
    socket.emit("gameUpdate", currentGame);
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

/* LOGIN + HOST */

app.post("/api/start-quiz", (req, res) => {

    if (!req.session.loggedIn) {
        return res.status(403).json({ error: "Niet toegestaan" });
    }

    const { gameId } = req.body;

    if (!gameId) {
        return res.json({ error: "Game ID verplicht" });
    }

    quizStarted = true;

    currentGame.id = gameId;
    currentGame.players = [];
    currentGame.scores = {};

    io.emit("gameUpdate", currentGame);

    res.json({ success: true });
});

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

app.get("/host", (req, res) => {
    if (!req.session.loggedIn) {
        return res.redirect("/host-login");
    }
    res.redirect("/start-quiz.html");
});

app.post("/start-game", (req, res) => {
    if (!req.session.loggedIn) {
        return res.status(403).send("Niet toegestaan");
    }

    currentGame.players = [];
    currentGame.scores = {};

    res.json({
        gameId: MANUAL_GAME_ID,
        playerUrl: "/player"
    });
});

app.get("/player", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "player-step1.html"));
});

app.get("/leaderboard", (req, res) => {

    if (!quizStarted) {
        return res.send("<h1>Quiz nog niet gestart</h1>");
    }

    res.sendFile(path.join(__dirname, "public", "leaderboard.html"));
});

/* -------- JOIN -------- */


app.post("/join", (req, res) => {

    const { name, gameId, character, playerId } = req.body;

    console.log("JOIN REQUEST:", req.body);

  if (!quizStarted || gameId !== currentGame.id) {
        return res.status(400).json({
            error: "Ongeldige Game ID"
        });
    }

    if (!allowedNames.includes(name)) {
        return res.status(403).json({
            error: "Deze naam is niet toegestaan!"
        });
    }

    const existingPlayer = currentGame.players.find(
        p => p.name.toLowerCase() === name.toLowerCase()
    );

    if (existingPlayer) {

        if (existingPlayer.playerId !== playerId) {
            return res.status(400).json({
                error: "Deze naam is al in gebruik!"
            });
        }

        existingPlayer.character = character;

        io.emit("gameUpdate", currentGame);
        return res.json({ success: true });
    }

    const characterTaken = currentGame.players.find(
        p => p.character === character && p.name !== name
    );

    if (characterTaken) {
        return res.status(400).json({
            error: "Dit personage is al gekozen!"
        });
    }

    req.session.playerName = name;

    currentGame.players.push({
        name,
        character,
        playerId
    });

    currentGame.scores[name] = 0;

    io.emit("gameUpdate", currentGame);

    res.json({ success: true });
});

/* SCORES */

app.get("/scores-full", (req, res) => {
    res.json({
        gameId: currentGame.id,
        scores: currentGame.scores,
        players: currentGame.players
    });
});

app.post("/reset-game", (req, res) => {

    if (!req.session.loggedIn) {
        return res.status(403).send("Niet toegestaan");
    }

    currentGame.players = [];
    currentGame.scores = {};

    io.emit("gameUpdate", currentGame);

    res.json({ success: true });
});

server.listen(process.env.PORT || 10000, "0.0.0.0", () => {
    console.log("Server draait op poort " + (process.env.PORT || 10000));
});





