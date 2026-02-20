// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const session = require("express-session");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// ---------------------
// Middleware
// ---------------------
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(session({
    secret: "efteling-secret-key",
    resave: false,
    saveUninitialized: true
}));

// Wachtwoord voor dashboard
const DASHBOARD_PASSWORD = "EftelJesss1234"; // pas dit aan

// ---------------------
// GAME DATA
// ---------------------
let game = {
    code: Math.floor(100000 + Math.random() * 900000).toString(),
    players: [],             // { id, name, character, score }
    currentQuestion: null,
    correctAnswers: [],
    questionActive: false,
    answers: [],             // { name, original, normalized, correct }
    errors: []               // { id, type, details, time, handled }
};

// ---------------------
// HELPERS
// ---------------------
function logError(type, details) {
    game.errors.push({
        id: uuidv4(),
        type,
        details,
        time: new Date(),
        handled: false
    });
}

// ---------------------
// ROUTES
// ---------------------

// Host login
app.get("/host-login", (req, res) => {
    res.sendFile(__dirname + "/public/host-login.html");
});

app.post("/host-login", (req, res) => {
    const { password } = req.body;
    if (password === DASHBOARD_PASSWORD) {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

// Dashboard / host
app.get("/host", (req, res) => {
    if (!req.session.authenticated) {
        return res.redirect("/host-login");
    }
    res.sendFile(__dirname + "/public/host.html");
});

// Leaderboard
app.get("/leaderboard", (req, res) => {
    res.sendFile(__dirname + "/public/leaderboard.html");
});

// Player steps
app.get("/player-step1", (req, res) => {
    res.sendFile(__dirname + "/public/player-step1.html");
});
app.get("/player-step2", (req, res) => {
    res.sendFile(__dirname + "/public/player-step2.html");
});
app.get("/player-step3", (req, res) => {
    res.sendFile(__dirname + "/public/player-step3.html");
});

// Game code API
app.get("/gamecode", (req, res) => {
    res.json({ code: game.code });
});

// Errors API
app.get("/errors", (req, res) => {
    res.json(game.errors);
});

// ---------------------
// SOCKET.IO
// ---------------------
io.on("connection", (socket) => {

    // -----------------
    // Player joins
    // -----------------
    socket.on("joinGame", ({ name, code, character }) => {

        // Game code check
        if (code !== game.code) {
            socket.emit("invalidCode");
            logError("Invalid Game ID", { attemptedId: code, name });
            return;
        }

        // Naam check
        if (game.players.find(p => p.name === name)) {
            socket.emit("nameTaken");
            return;
        }

        // Voeg speler toe
        const player = {
            id: socket.id,
            name,
            character,
            score: 0
        };

        game.players.push(player);

        // Update host dashboard en leaderboard
        io.emit("updatePlayers", game.players);
    });

    // -----------------
    // Disconnect
    // -----------------
    socket.on("disconnect", () => {
        game.players = game.players.filter(p => p.id !== socket.id);
        io.emit("updatePlayers", game.players);
    });

    // -----------------
    // Host zet vraag
    // -----------------
    socket.on("setQuestion", ({ question, correct }) => {
        game.currentQuestion = question;
        game.correctAnswers = correct.map(a => a.toLowerCase());
        game.answers = [];
        io.emit("newQuestion", question);
    });

    // Host start vraag
    socket.on("startQuestion", () => {
        game.questionActive = true;
        io.emit("questionStarted", 30); // 30 sec timer
    });

    // Player stuurt antwoord
    socket.on("submitAnswer", ({ name, answer }) => {
        if (!game.questionActive) return;

        const normalized = answer.trim().toLowerCase();
        const isCorrect = game.correctAnswers.some(correct =>
            normalized.includes(correct)
        );

        game.answers.push({
            name,
            original: answer,
            normalized,
            correct: isCorrect
        });

        socket.emit("answerResult", isCorrect);
    });

    // Host stopt vraag
    socket.on("stopQuestion", () => {
        game.questionActive = false;
        io.emit("showResults", game.answers);
    });

    // Markeer error afgehandeld
    socket.on("handleError", (errorId) => {
        const e = game.errors.find(err => err.id === errorId);
        if (e) {
            e.handled = !e.handled; // toggle afgehandeld
            io.emit("updateErrors", game.errors);
        }
    });

    // Kick speler
    socket.on("kickPlayer", (playerId) => {
        game.players = game.players.filter(p => p.id !== playerId);
        io.emit("updatePlayers", game.players);
    });

});

// ---------------------
// START SERVER
// ---------------------
server.listen(PORT, () => {
    console.log("Server draait 🚀 op port " + PORT);
});

