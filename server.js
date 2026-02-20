const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

/* ================= SETTINGS ================= */

const DASHBOARD_PASSWORD = "efteling123"; // 🔐 verander dit
const ALLOWED_NAMES = ["Jestin", "Jules", "Levi", "Bink", "Symen"]; // 🔥 verander dit

let CHARACTERS = []; // jij vult dit via script

/* ================= GAME STATE ================= */

let game = {
    code: Math.floor(100000 + Math.random() * 900000).toString(),
    players: [],
    phase: "lobby",
    questionList: [],
    currentQuestionIndex: -1,
    errors: []
};

/* ================= MIDDLEWARE ================= */

app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: "efteling-secret",
    resave: false,
    saveUninitialized: true
}));

/* ================= AUTH ================= */

app.post("/login", (req, res) => {
    if (req.body.password === DASHBOARD_PASSWORD) {
        req.session.auth = true;
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

function checkAuth(req, res, next) {
    if (req.session.auth) next();
    else res.redirect("/host-login.html");
}

/* ================= ROUTES ================= */

app.get("/", (req, res) => res.redirect("/leaderboard"));
app.get("/leaderboard", (req, res) => res.sendFile(__dirname + "/public/leaderboard.html"));
app.get("/player", (req, res) => res.sendFile(__dirname + "/public/player.html"));
app.get("/host", checkAuth, (req, res) => res.sendFile(__dirname + "/public/host.html"));
app.get("/gamecode", (req, res) => res.json({ code: game.code }));

/* ================= SOCKET ================= */

io.on("connection", (socket) => {

    socket.emit("updatePlayers", game.players);
    socket.emit("updateErrors", game.errors);
    socket.emit("phaseUpdate", game.phase);

    socket.on("joinGame", ({ name, character }) => {

        if (!ALLOWED_NAMES.includes(name)) {
            socket.emit("nameNotAllowed");
            return;
        }

        if (game.players.find(p => p.name === name)) {
            socket.emit("nameTaken");
            return;
        }

        game.players.push({
            id: socket.id,
            name,
            character,
            score: 0
        });

        io.emit("updatePlayers", game.players);
    });

    socket.on("addQuestion", (data) => {
        game.questionList.push(data);
        io.emit("updateQuestions", game.questionList);
    });

    socket.on("nextPhase", () => {
        if (game.phase === "lobby") {
            game.currentQuestionIndex++;
            game.phase = "question";
        } else if (game.phase === "question") {
            game.phase = "results";
        } else {
            game.phase = "lobby";
        }

        io.emit("phaseUpdate", game.phase);
        io.emit("updatePlayers", game.players);
    });

    socket.on("previousPhase", () => {
        if (game.phase === "results") {
            game.phase = "question";
        } else if (game.phase === "question") {
            game.phase = "lobby";
            game.currentQuestionIndex--;
        }

        io.emit("phaseUpdate", game.phase);
    });

    socket.on("markError", (id) => {
        const err = game.errors.find(e => e.id === id);
        if (err) err.handled = !err.handled;
        io.emit("updateErrors", game.errors);
    });

});
server.listen(PORT, () => console.log("Server draait 🚀"));
