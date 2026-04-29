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

// Wachtende join-aanvragen: token -> { name, playerId, socketId }
let pendingApprovals = {};

// ---------------- MIDDLEWARE ----------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
    index: false
}));

app.set("trust proxy", 1); // Render draait achter een proxy

app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV !== "development", // true op Render (HTTPS), false lokaal
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 4 // 4 uur
    }
}));

// /host.html wordt nu afgehandeld door de beveiligde route hieronder

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
    // BUG FIX: stuur ?error=1 mee zodat de loginpagina een foutmelding kan tonen
    return res.redirect("/host-login?error=1");
});

app.get("/start-quiz", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");
    res.sendFile(path.join(__dirname, "public", "start-quiz.html"));
});

// ---------------- HOST DASHBOARD ----------------
// /host en /host.html beiden beveiligd — redirect naar login als niet ingelogd
app.get("/host", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");
    res.sendFile(path.join(__dirname, "public", "host.html"));
});

app.get("/host.html", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");
    res.sendFile(path.join(__dirname, "public", "host.html"));
});

// ---------------- START QUIZ ----------------
app.post("/api/start-quiz", (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });

    const { gameId } = req.body;
    if (!gameId) return res.json({ error: "Game ID verplicht" });

    quizStarted = true;
    currentGame.id = gameId;
    currentGame.players = [];
    currentGame.scores = {};
    nextJoinId = 1001;

    pendingPlayers = [
        { name: "Jestin", joinId: 1001 },
        { name: "Luca",   joinId: 1002 },
        { name: "Jules",  joinId: 1003 },
        { name: "Levi",   joinId: 1004 },
        { name: "Bink",   joinId: 1005 },
        { name: "Symen",  joinId: 1006 }
    ];

    console.log("Quiz gestart, pendingPlayers:", pendingPlayers);

    io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    return res.json({ success: true });
});

app.get("/player", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "player-scan.html"));
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

    // Sla naam + gameId op in localStorage en stuur naar wachtpagina
    res.send(`
<script>
localStorage.setItem("playerName", "${player.name}");
localStorage.setItem("gameId", "${currentGame.id}");
window.location.href="/join-aanvraag.html";
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

    const existingPlayer = currentGame.players.find(
        p => p.name.toLowerCase() === name.toLowerCase()
    );

    if (existingPlayer) {
        if (existingPlayer.playerId !== playerId)
            return res.status(400).json({ error: "Naam al in gebruik!" });

        // Alleen personage updaten als er een meegegeven is
        if (character) {
            const characterTaken = currentGame.players.find(
                p => p.character === character && p.name !== name
            );
            if (characterTaken)
                return res.status(400).json({ error: "Dit personage is al gekozen!" });

            existingPlayer.character = character;
        }

        io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
        return res.json({ success: true });
    }

    // Nieuwe speler — personage hoeft nog niet gekozen te zijn
    if (character) {
        const characterTaken = currentGame.players.find(
            p => p.character === character && p.name !== name
        );
        if (characterTaken)
            return res.status(400).json({ error: "Dit personage is al gekozen!" });
    }

    currentGame.players.push({
        name,
        character: character || null,
        playerId,
        joinId: pendingPlayers.find(p => p.name === name)?.joinId || nextJoinId++
    });
    currentGame.scores[name] = 0;

    io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    return res.json({ success: true });
});

// ---------------- SPELLEIDER LOGIN ----------------
const SPELLEIDER_PASSWORD = "1234"; // zelfde wachtwoord, apart gehouden voor uitbreidbaarheid

app.get("/join-indien", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "join-indien.html"));
});

app.post("/spelleider-login", (req, res) => {
    const password = (req.body.password || "").trim();
    if (password === SPELLEIDER_PASSWORD) {
        req.session.spelleider = true;
        return res.json({ success: true });
    }
    return res.status(401).json({ error: "Ongeldig wachtwoord" });
});

app.get("/spelleider-status", (req, res) => {
    res.json({ loggedIn: !!req.session.spelleider });
});

// ---------------- JOIN AANVRAAG ----------------
// Speler vraagt een token aan om goedkeuring te wachten
app.post("/api/join-aanvragen", (req, res) => {
    const { name, playerId } = req.body;

    if (!quizStarted)
        return res.status(400).json({ error: "Quiz niet gestart" });

    if (!allowedNames.includes(name))
        return res.status(403).json({ error: "Naam niet toegestaan" });

    // Genereer uniek token voor deze aanvraag
    const token = "tok_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    pendingApprovals[token] = { name, playerId, time: Date.now() };

    // Stuur naar spelleider via socket
    io.emit("gameUpdate", { type: "joinAanvraag", token, name });

    return res.json({ success: true, token });
});

// Spelleider accepteert
app.post("/api/join-accepteren", (req, res) => {
    if (!req.session.spelleider) return res.status(401).json({ error: "Niet ingelogd" });

    const { token } = req.body;
    const aanvraag = pendingApprovals[token];
    if (!aanvraag) return res.status(404).json({ error: "Aanvraag niet gevonden" });

    delete pendingApprovals[token];

    // Stuur naar de wachtende speler
    io.emit("joinBeslissing", { token, beslissing: "geaccepteerd", name: aanvraag.name });

    return res.json({ success: true });
});

// Spelleider wijst af
app.post("/api/join-afwijzen", (req, res) => {
    if (!req.session.spelleider) return res.status(401).json({ error: "Niet ingelogd" });

    const { token } = req.body;
    const aanvraag = pendingApprovals[token];
    if (!aanvraag) return res.status(404).json({ error: "Aanvraag niet gevonden" });

    delete pendingApprovals[token];

    io.emit("joinBeslissing", { token, beslissing: "afgewezen", name: aanvraag.name });

    return res.json({ success: true });
});

// Geeft lijst van openstaande aanvragen terug (voor join-indien.html)
app.get("/api/join-aanvragen", (req, res) => {
    if (!req.session.spelleider) return res.status(401).json({ error: "Niet ingelogd" });
    res.json({ aanvragen: Object.entries(pendingApprovals).map(([token, v]) => ({ token, ...v })) });
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
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });

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

    socket.on("helpRequest", data => {
        io.emit("gameUpdate", {
            type: "helpRequest",
            name: data.name || "Niet bekend"
        });
    });
});

// ---------------- SERVER ----------------
server.listen(PORT, "0.0.0.0", () => {
    console.log("Server draait op poort " + PORT);
});
