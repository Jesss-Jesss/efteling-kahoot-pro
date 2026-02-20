// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// Wachtwoord dashboard
const DASHBOARD_PASSWORD = "MijnEftelingSecret!";

// Middleware voor POST body
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static folder
app.use(express.static(path.join(__dirname, "public")));

/* ======================
   GAME DATA
====================== */
let gameCode = Math.floor(100000 + Math.random() * 900000).toString();
let players = [];
let currentQuestion = null;
let correctAnswers = [];
let questionActive = false;
let answers = [];
let errors = [];

// Helper foutmeldingen
function logError(type, details) {
    errors.push({
        id: uuidv4(),
        type,
        details,
        time: new Date(),
        handled: false
    });
}

/* ======================
   ROUTES
====================== */

// Home redirect
app.get("/", (req, res) => {
    res.redirect("/host-login");
});

// Host login pagina
app.get("/host-login", (req, res) => {
    res.sendFile(path.join(__dirname, "public/host-login.html"));
});

// Host login POST
app.post("/host-login", (req, res) => {
    const pw = req.body.password;
    if (pw !== DASHBOARD_PASSWORD) {
        return res.status(401).send("Wachtwoord fout");
    }
    res.redirect("/host");
});

// Host dashboard
app.get("/host", (req, res) => {
    res.sendFile(path.join(__dirname, "public/host.html"));
});

// Player scherm 3-step
app.get("/player-step1", (req, res) => res.sendFile(path.join(__dirname, "public/player-step1.html")));
app.get("/player-step2", (req, res) => res.sendFile(path.join(__dirname, "public/player-step2.html")));
app.get("/player-step3", (req, res) => res.sendFile(path.join(__dirname, "public/player-step3.html")));

// Leaderboard
app.get("/leaderboard", (req, res) => res.sendFile(path.join(__dirname, "public/leaderboard.html")));

// Game code API
app.get("/gamecode", (req, res) => {
    res.json({ code: gameCode });
});

// Errors API
app.get("/errors", (req, res) => res.json(errors));

/* ======================
   SOCKET.IO
====================== */

io.on("connection", (socket) => {
    console.log("Nieuwe connectie:", socket.id);

    // Player join
    socket.on("joinGame", ({ name, code, character }) => {
        if (code !== gameCode) {
            socket.emit("invalidCode");
            logError("Ongeldige Game-ID", { attemptedId: code, name });
            return;
        }

        if (players.find(p => p.name === name)) {
            socket.emit("nameTaken");
            return;
        }

        const player = { id: socket.id, name, score: 0, character };
        players.push(player);
        socket.join("gameRoom");

        io.to("gameRoom").emit("updatePlayers", players);
    });

    // Disconnect
    socket.on("disconnect", () => {
        players = players.filter(p => p.id !== socket.id);
        io.to("gameRoom").emit("updatePlayers", players);
    });

    // Host zet vraag
    socket.on("setQuestion", ({ question, correct }) => {
        currentQuestion = question;
        correctAnswers = correct.map(a => a.toLowerCase());
        answers = [];
        io.emit("newQuestion", question);
    });

    // Host start vraag
    socket.on("startQuestion", () => {
        questionActive = true;
        io.emit("questionStarted", 30);
    });

    // Player antwoord
    socket.on("submitAnswer", ({ name, answer }) => {
        if (!questionActive) return;

        const normalized = answer.trim().toLowerCase();
        const isCorrect = correctAnswers.some(c => normalized.includes(c));

        answers.push({
            name,
            original: answer,
            normalized,
            correct: isCorrect
        });

        socket.emit("answerResult", isCorrect);
    });

    // Host stopt vraag
    socket.on("stopQuestion", () => {
        questionActive = false;
        io.emit("showResults", answers);
    });
});

/* ======================
   START SERVER
====================== */

server.listen(PORT, () => {
    console.log("Server draait 🚀 op poort " + PORT);
});
