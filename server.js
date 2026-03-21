const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 10000;

// ---------------- VARIABLES ----------------
let quizStarted = false;
const DASHBOARD_PASSWORD = "1234";
const allowedNames = ["Jestin","Luca","Jules","Levi","Bink","Symen"];
let nextJoinId = 1001;
let pendingPlayers = [];

let currentGame = {
    id: null,
    players: [],
    scores: {}
};

// ---------------- MIDDLEWARE ----------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false
}));

// ---------------- LOGIN ----------------
app.get("/", (req, res) => res.redirect("/host-login"));

app.get("/host-login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "host-login.html"));
});

app.post("/host-login", (req, res) => {
    const password = (req.body.password || "").trim();
    if (password === DASHBOARD_PASSWORD) {
        req.session.loggedIn = true;
        return res.redirect("/start-quiz");
    }
    return res.redirect("/host-login");
});

// ---------------- HOST DASHBOARD ----------------
app.get("/host", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");

    req.session.destroy(() => {
        res.sendFile(path.join(__dirname, "public", "host.html"));
    });
});
// ---------------- START QUIZ ----------------

app.get("/player", (req, res) => {
    if (!quizStarted) return res.send("Quiz nog niet gestart");
    res.sendFile(path.join(__dirname, "public", "player.html"));
});

app.post("/api/start-quiz", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");

    const { gameId } = req.body;
    if (!gameId) return res.json({ error: "Game ID verplicht" });

    quizStarted = true;
    currentGame.id = gameId;
    currentGame.players = [];
    currentGame.scores = {};
    nextJoinId = 1001;

    // vul pendingPlayers automatisch
    pendingPlayers = [
    { name: "Jestin", joinId: 1001 },
    { name: "Luca", joinId: 1002 },
    { name: "Jules", joinId: 1003 },
    { name: "Levi", joinId: 1004 },
    { name: "Bink", joinId: 1005 },
    { name: "Symen", joinId: 1006 }
];

    console.log("Quiz gestart, pendingPlayers:", pendingPlayers);

    io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    return res.json({ success: true });
});

// ---------------- PLAYER ----------------
app.get("/player/:joinId", (req, res) => {
    if (!quizStarted) return res.send("Quiz nog niet gestart");

    const joinId = Number(req.params.joinId);
    const player = pendingPlayers.find(p => p.joinId === joinId);

    if (!player) {
        console.log("Ongeldige joinId:", joinId, "PendingPlayers:", pendingPlayers);
        return res.send("Ongeldige spelercode");
    }

    // speler kan nu joinen
    res.send(`
<script>
localStorage.setItem("playerName", "${player.name}");
localStorage.setItem("gameId", "${currentGame.id}");
window.location.href="/player-step3.html";
</script>
`);
});

// ---------------- JOIN ----------------
app.post("/join", (req, res) => {
    const { name, gameId, character, playerId } = req.body;

    if (!quizStarted || gameId !== currentGame.id)
        return res.status(400).json({ error: "Ongeldige Game ID" });

    if (!allowedNames.includes(name))
        return res.status(403).json({ error: "Naam niet toegestaan" });

    const existingPlayer = currentGame.players.find(p => p.name.toLowerCase() === name.toLowerCase());

    if (existingPlayer) {
        if (existingPlayer.playerId !== playerId)
            return res.status(400).json({ error: "Naam al in gebruik!" });

        existingPlayer.character = character;
        io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
        return res.json({ success: true });
    }

    const characterTaken = currentGame.players.find(
    p => p.character === character && p.name !== name
);

if (characterTaken) {
    return res.status(400).json({ error: "Dit personage is al gekozen!" });
}

    // voeg speler toe
    req.session.playerName = name;
    currentGame.players.push({
        name,
        character,
        playerId,
        joinId: pendingPlayers.find(p => p.name === name)?.joinId || nextJoinId++
    });
    currentGame.scores[name] = 0;

    io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    return res.json({ success: true });
});

// ---------------- LEADERBOARD ----------------
app.get("/leaderboard", (req, res) => {
    if (!quizStarted) return res.sendFile(path.join(__dirname, "public", "quiz-not-started.html"));
    return res.sendFile(path.join(__dirname, "public", "leaderboard.html"));
});

// ---------------- SCORES ----------------
app.get("/scores-full", (req, res) => {
    res.json({
        gameId: currentGame.id,
        scores: currentGame.scores,
        players: currentGame.players
    });
});

// ---------------- RESET GAME ----------------
app.post("/reset-game", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");

    quizStarted = false;
    currentGame.players = [];
    currentGame.scores = {};
    currentGame.id = null;
    nextJoinId = 1001;
    pendingPlayers = [];

    io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    return res.json({ success: true });
});

// ---------------- SOCKET.IO ----------------
io.on("connection", (socket) => {
    console.log("Nieuwe gebruiker verbonden");
    socket.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    socket.emit("phaseUpdate", "lobby");
});

// ---------------- SERVER ----------------
server.listen(PORT, "0.0.0.0", () => {
    console.log("Server draait op poort " + PORT);
});
