const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

app.use(express.static("public"));

/* ======================
   GAME STATE
====================== */

let game = {
    code: Math.floor(100000 + Math.random() * 900000).toString(),
    players: [],
    errors: [],
    phase: "lobby", // lobby → question → results
    currentQuestion: null,
    correctAnswers: [],
    answers: []
};

/* ======================
   ERROR SYSTEM
====================== */

function addError(type, details) {
    game.errors.push({
        id: Date.now() + Math.random(),
        type,
        details,
        handled: false,
        time: new Date()
    });

    // Niet afgehandeld moet bovenaan
    game.errors.sort((a, b) => a.handled - b.handled);
}

/* ======================
   ROUTES
====================== */

app.get("/", (req, res) => res.redirect("/leaderboard"));
app.get("/host", (req, res) => res.sendFile(__dirname + "/public/host.html"));
app.get("/player", (req, res) => res.sendFile(__dirname + "/public/player.html"));
app.get("/leaderboard", (req, res) => res.sendFile(__dirname + "/public/leaderboard.html"));
app.get("/gamecode", (req, res) => res.json({ code: game.code }));

/* ======================
   SOCKET
====================== */

io.on("connection", (socket) => {

    socket.emit("updatePlayers", game.players);
    socket.emit("updateErrors", game.errors);
    socket.emit("phaseUpdate", game.phase);

    /* JOIN */
    socket.on("joinGame", ({ name, code }) => {

        if (code !== game.code) {
            socket.emit("invalidCode");
            addError("Ongeldige code", { name, code });
            io.emit("updateErrors", game.errors);
            return;
        }

        if (game.players.find(p => p.name === name)) {
            socket.emit("nameTaken");
            addError("Dubbele naam", { name });
            io.emit("updateErrors", game.errors);
            return;
        }

        const player = {
            id: socket.id,
            name,
            score: 0
        };

        game.players.push(player);
        io.emit("updatePlayers", game.players);
    });

    /* KICK */
    socket.on("kickPlayer", (id) => {
        game.players = game.players.filter(p => p.id !== id);
        io.emit("updatePlayers", game.players);
    });

    /* MARK ERROR */
    socket.on("markError", (id) => {
        const err = game.errors.find(e => e.id === id);
        if (err) err.handled = !err.handled;
        game.errors.sort((a, b) => a.handled - b.handled);
        io.emit("updateErrors", game.errors);
    });

    /* SET QUESTION */
    socket.on("setQuestion", ({ question, correct }) => {
        game.currentQuestion = question;
        game.correctAnswers = correct.map(a => a.trim().toLowerCase());
        game.answers = [];
    });

    /* NEXT PHASE */
    socket.on("nextPhase", () => {
        if (game.phase === "lobby") game.phase = "question";
        else if (game.phase === "question") game.phase = "results";
        else game.phase = "lobby";

        io.emit("phaseUpdate", game.phase);

        if (game.phase === "question") {
            io.emit("newQuestion", game.currentQuestion);
            io.emit("startTimer", 30);
        }

        if (game.phase === "results") {
            io.emit("showResults", game.answers);
        }
    });

    /* ANSWERS */
    socket.on("submitAnswer", ({ name, answer }) => {

        const normalized = answer.trim().toLowerCase();

        const isCorrect = game.correctAnswers.some(correct =>
            normalized.includes(correct)
        );

        const player = game.players.find(p => p.name === name);
        if (player && isCorrect) player.score += 10;

        game.answers.push({
            name,
            original: answer,
            normalized,
            correct: isCorrect
        });

        socket.emit("answerResult", isCorrect);
    });

});

server.listen(PORT, () => {
    console.log("Server running on " + PORT);
});
