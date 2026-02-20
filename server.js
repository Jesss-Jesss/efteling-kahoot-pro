const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

app.use(express.static("public"));

/* ======================
   GAME DATA
====================== */

let game = {
    code: Math.floor(100000 + Math.random() * 900000).toString(),
    players: [],
    currentQuestion: null,
    correctAnswers: [],
    questionActive: false,
    answers: []
};

/* ======================
   ROUTES
====================== */

app.get("/", (req, res) => res.redirect("/host"));

app.get("/host", (req, res) =>
    res.sendFile(__dirname + "/public/host.html")
);

app.get("/player", (req, res) =>
    res.sendFile(__dirname + "/public/player.html")
);

app.get("/leaderboard", (req, res) =>
    res.sendFile(__dirname + "/public/leaderboard.html")
);

app.get("/gamecode", (req, res) =>
    res.json({ code: game.code })
);

/* ======================
   SOCKET.IO
====================== */

io.on("connection", (socket) => {

    // JOIN
    socket.on("joinGame", ({ name, code }) => {

        if (code !== game.code) {
            socket.emit("invalidCode");
            return;
        }

        if (game.players.find(p => p.name === name)) {
            socket.emit("nameTaken");
            return;
        }

        const player = {
            id: socket.id,
            name: name,
            score: 0
        };

        game.players.push(player);
        io.emit("updatePlayers", game.players);
    });

    // DISCONNECT
    socket.on("disconnect", () => {
        game.players = game.players.filter(p => p.id !== socket.id);
        io.emit("updatePlayers", game.players);
    });

    // SET QUESTION
    socket.on("setQuestion", ({ question, correct }) => {
        game.currentQuestion = question;
        game.correctAnswers = correct.map(a => a.trim().toLowerCase());
        game.answers = [];
        io.emit("newQuestion", question);
    });

    // START QUESTION
    socket.on("startQuestion", () => {
        game.questionActive = true;
        io.emit("questionStarted", 30);
    });

    // SUBMIT ANSWER
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

    // STOP QUESTION
    socket.on("stopQuestion", () => {
        game.questionActive = false;
        io.emit("showResults", game.answers);
    });

});

/* ======================
   START SERVER
====================== */

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
