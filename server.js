const express = require("express");
const path = require("path");
const session = require("express-session");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 10000;

const DASHBOARD_PASSWORD = "1234";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: true
}));

let currentGame = null;

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

/* -------- HOST (BEVEILIGD) -------- */

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

    currentGame = {
        id: uuidv4().slice(0, 6),
        players: [],
        scores: {}
    };

    res.json({ gameId: currentGame.id });
});

/* -------- PLAYER -------- */

app.get("/player", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "player.html"));
});

/* -------- JOIN -------- */

app.post("/join", (req, res) => {
    const { name, gameId } = req.body;

    if (!currentGame || gameId !== currentGame.id) {
        return res.status(400).json({ error: "Game niet gevonden" });
    }

    currentGame.players.push(name);
    currentGame.scores[name] = 0;

    res.json({ success: true });
});

/* -------- LEADERBOARD -------- */

app.get("/leaderboard", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "leaderboard.html"));
});

app.get("/scores", (req, res) => {
    if (!currentGame) return res.json({});
    res.json(currentGame.scores);
});

/* -------- SERVER -------- */

app.listen(PORT, () => {
    console.log("Server draait op poort " + PORT);
});
