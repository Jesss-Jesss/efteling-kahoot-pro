const express  = require("express");
const http     = require("http");
const { Server } = require("socket.io");
const path     = require("path");
const session  = require("express-session");
const mongoose = require("mongoose");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 10000;

// ---------------- MONGODB ----------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/eftelingquiz";

mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB verbonden"))
    .catch(err => console.error("MongoDB fout:", err));

const vraagSchema = new mongoose.Schema({
    type:       { type: String, enum: ["meerkeuze", "open"], default: "meerkeuze" },
    vraag:      { type: String, required: true },
    antwoorden: [{ tekst: String, correct: Boolean }],
    tijdlimiet: { type: Number, default: 20 },
    punten:     { type: Number, default: 1000 }
});

const quizSchema = new mongoose.Schema({
    naam:       { type: String, required: true },
    vragen:     [vraagSchema],
    aangemaakt: { type: Date, default: Date.now },
    bijgewerkt: { type: Date, default: Date.now }
});

const Quiz = mongoose.model("Quiz", quizSchema);

// ---------------- VARIABLES ----------------
let quizStarted = false;
const DASHBOARD_PASSWORD = "1234";
const allowedNames = ["Jestin","Luca","Jules","Levi","Bink","Symen"];
let nextJoinId = 1001;
let pendingPlayers = [];

// Fase per vraag: "lobby" | "vraag" | "resultaten" | "podium" | "eindpodium"
let currentGame = {
    id: null,
    players: [],
    scores: {},
    quizId: null,
    quizData: null,
    huidigeVraag: -1,
    fase: "lobby",
    // Antwoorden voor de huidige vraag: { playerName: { antwoordIndex, tijdstip } }
    antwoorden: {},
    vraagStartTijd: null
};

let pendingApprovals = {};

// ---------------- HELPERS ----------------
function berekenPunten(vraag, seconden) {
    // Basispunten + bonus voor snelheid (max tijdlimiet seconden)
    const basis = vraag.punten || 1000;
    const tijdlimiet = vraag.tijdlimiet || 20;
    const overig = Math.max(0, tijdlimiet - seconden);
    const bonus = Math.round((overig / tijdlimiet) * basis * 0.1); // max 10% bonus
    return basis + bonus;
}

function berekenResultaten() {
    if (!currentGame.quizData) return null;
    const vraag = currentGame.quizData.vragen[currentGame.huidigeVraag];
    if (!vraag) return null;

    const tellingen = {};
    vraag.antwoorden.forEach((a, i) => { tellingen[i] = 0; });

    const details = {};
    Object.entries(currentGame.antwoorden).forEach(([name, data]) => {
        const idx = data.antwoordIndex;
        tellingen[idx] = (tellingen[idx] || 0) + 1;
        details[name] = data;
    });

    const totaal = Object.values(tellingen).reduce((s, n) => s + n, 0);

    return {
        vraag: vraag.vraag,
        antwoorden: vraag.antwoorden.map((a, i) => ({
            tekst: a.tekst,
            correct: a.correct,
            aantal: tellingen[i] || 0,
            procent: totaal > 0 ? Math.round((tellingen[i] || 0) / totaal * 100) : 0
        })),
        totaalAntwoorden: totaal,
        spelersDetails: details
    };
}

function berekenPodium() {
    const gesorteerd = Object.entries(currentGame.scores)
        .map(([name, score]) => {
            const player = currentGame.players.find(p => p.name === name);
            return { name, score, character: player?.character || null };
        })
        .sort((a, b) => b.score - a.score);
    return gesorteerd;
}

// ---------------- MIDDLEWARE ----------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
    index: false,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) res.setHeader("Content-Type", "text/html");
    }
}));

app.use((req, res, next) => {
    if (req.path.endsWith(".html")) return res.redirect(req.path.replace(".html", ""));
    next();
});

app.set("trust proxy", 1);

app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV !== "development",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 4
    }
}));

// ---------------- LOGIN ----------------
app.get("/", (req, res) => res.redirect("/host-login"));

app.get("/host-login", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "host-login.html")));

app.post("/host-login", (req, res) => {
    const password = (req.body.password || "").trim();
    if (password === DASHBOARD_PASSWORD) {
        req.session.loggedIn = true;
        return res.redirect("/quiz-select");
    }
    return res.redirect("/host-login?error=1");
});

app.get("/start-quiz", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");
    res.sendFile(path.join(__dirname, "public", "start-quiz.html"));
});

// ---------------- QUIZ SELECTIE & EDITOR ----------------
app.get("/quiz-select", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");
    res.sendFile(path.join(__dirname, "public", "quiz-select.html"));
});

app.get("/quiz-editor", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");
    res.sendFile(path.join(__dirname, "public", "quiz-editor.html"));
});

app.get("/api/quizzen", async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });
    try {
        const quizzen = await Quiz.find({}, "naam aangemaakt bijgewerkt vragen").sort({ bijgewerkt: -1 });
        res.json({ quizzen });
    } catch (e) { res.status(500).json({ error: "Fout bij ophalen quizzen" }); }
});

app.get("/api/quizzen/:id", async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });
    try {
        const quiz = await Quiz.findById(req.params.id);
        if (!quiz) return res.status(404).json({ error: "Quiz niet gevonden" });
        res.json({ quiz });
    } catch (e) { res.status(500).json({ error: "Fout bij ophalen quiz" }); }
});

app.post("/api/quizzen", async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });
    try {
        const { naam, vragen } = req.body;
        if (!naam) return res.status(400).json({ error: "Naam verplicht" });
        const quiz = new Quiz({ naam, vragen: vragen || [] });
        await quiz.save();
        res.json({ success: true, quiz });
    } catch (e) { res.status(500).json({ error: "Fout bij aanmaken quiz" }); }
});

app.put("/api/quizzen/:id", async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });
    try {
        const { naam, vragen } = req.body;
        const quiz = await Quiz.findByIdAndUpdate(
            req.params.id,
            { naam, vragen, bijgewerkt: new Date() },
            { new: true }
        );
        if (!quiz) return res.status(404).json({ error: "Quiz niet gevonden" });
        res.json({ success: true, quiz });
    } catch (e) { res.status(500).json({ error: "Fout bij opslaan quiz" }); }
});

app.delete("/api/quizzen/:id", async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });
    try {
        await Quiz.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Fout bij verwijderen quiz" }); }
});

// ---------------- HOST DASHBOARD ----------------
app.get("/host", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");
    res.sendFile(path.join(__dirname, "public", "host.html"));
});
app.get("/host.html", (req, res) => {
    if (!req.session.loggedIn) return res.redirect("/host-login");
    res.sendFile(path.join(__dirname, "public", "host.html"));
});

// ---------------- START QUIZ ----------------
app.post("/api/start-quiz", async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });
    const { gameId, quizId } = req.body;
    if (!gameId) return res.json({ error: "Game ID verplicht" });
    if (!quizId) return res.json({ error: "Selecteer eerst een quiz" });

    try {
        const quiz = await Quiz.findById(quizId);
        if (!quiz) return res.status(404).json({ error: "Quiz niet gevonden" });

        quizStarted = true;
        currentGame.id           = gameId;
        currentGame.players      = [];
        currentGame.scores       = {};
        currentGame.quizId       = quizId;
        currentGame.quizData     = quiz;
        currentGame.huidigeVraag = -1;
        currentGame.fase         = "lobby";
        currentGame.antwoorden   = {};
        currentGame.vraagStartTijd = null;
        nextJoinId = 1001;

        pendingPlayers = [
            { name: "Jestin", joinId: 1001 },
            { name: "Luca",   joinId: 1002 },
            { name: "Jules",  joinId: 1003 },
            { name: "Levi",   joinId: 1004 },
            { name: "Bink",   joinId: 1005 },
            { name: "Symen",  joinId: 1006 }
        ];

        io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
        io.emit("faseUpdate", { fase: "lobby" });
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: "Fout bij starten quiz" });
    }
});

// ---------------- PLAYER ----------------
app.get("/player", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "player-scan.html")));

app.get("/player/:joinId", (req, res) => {
    if (!quizStarted) return res.send("Quiz nog niet gestart");
    const joinId = Number(req.params.joinId);
    const player = pendingPlayers.find(p => p.joinId === joinId);
    if (!player) return res.send("Ongeldige spelercode");
    res.send(`<script>
localStorage.setItem("playerName","${player.name}");
localStorage.setItem("gameId","${currentGame.id}");
window.location.href="/join-aanvraag.html";
</script>`);
});

// Player quiz-pagina (antwoorden geven)
app.get("/quiz", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "quiz-player.html")));

// ---------------- JOIN ----------------
app.post("/join", (req, res) => {
    const { name, gameId, character, playerId } = req.body;
    if (!quizStarted || gameId !== currentGame.id)
        return res.status(400).json({ error: "Ongeldige Game ID" });
    if (!allowedNames.includes(name))
        return res.status(403).json({ error: "Naam niet toegestaan" });

    const existingPlayer = currentGame.players.find(
        p => p.name.toLowerCase() === name.toLowerCase());

    if (existingPlayer) {
        if (existingPlayer.playerId !== playerId)
            return res.status(400).json({ error: "Naam al in gebruik!" });
        if (character) {
            const taken = currentGame.players.find(p => p.character === character && p.name !== name);
            if (taken) return res.status(400).json({ error: "Dit personage is al gekozen!" });
            existingPlayer.character = character;
        }
        io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
        return res.json({ success: true });
    }

    if (character) {
        const taken = currentGame.players.find(p => p.character === character && p.name !== name);
        if (taken) return res.status(400).json({ error: "Dit personage is al gekozen!" });
    }

    currentGame.players.push({
        name, character: character || null, playerId,
        joinId: pendingPlayers.find(p => p.name === name)?.joinId || nextJoinId++
    });
    currentGame.scores[name] = 0;

    io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    return res.json({ success: true });
});

// ---------------- SPELLEIDER LOGIN ----------------
const SPELLEIDER_PASSWORD = "1234";

app.get("/join-indienen", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "join-indienen.html")));

app.post("/spelleider-login", (req, res) => {
    const password = (req.body.password || "").trim();
    if (password === SPELLEIDER_PASSWORD) {
        req.session.spelleider = true;
        return res.json({ success: true });
    }
    return res.status(401).json({ error: "Ongeldig wachtwoord" });
});

app.get("/spelleider-status", (req, res) =>
    res.json({ loggedIn: !!req.session.spelleider }));

// ---------------- JOIN AANVRAAG ----------------
app.post("/api/join-aanvragen", (req, res) => {
    const { name, playerId } = req.body;
    if (!quizStarted) return res.status(400).json({ error: "Quiz niet gestart" });
    if (!allowedNames.includes(name)) return res.status(403).json({ error: "Naam niet toegestaan" });
    const token = "tok_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    pendingApprovals[token] = { name, playerId, time: Date.now() };
    io.emit("gameUpdate", { type: "joinAanvraag", token, name });
    return res.json({ success: true, token });
});

app.post("/api/join-accepteren", (req, res) => {
    if (!req.session.spelleider) return res.status(401).json({ error: "Niet ingelogd" });
    const { token } = req.body;
    const aanvraag = pendingApprovals[token];
    if (!aanvraag) return res.status(404).json({ error: "Aanvraag niet gevonden" });
    delete pendingApprovals[token];
    io.emit("joinBeslissing", { token, beslissing: "geaccepteerd", name: aanvraag.name });
    return res.json({ success: true });
});

app.post("/api/join-afwijzen", (req, res) => {
    if (!req.session.spelleider) return res.status(401).json({ error: "Niet ingelogd" });
    const { token } = req.body;
    const aanvraag = pendingApprovals[token];
    if (!aanvraag) return res.status(404).json({ error: "Aanvraag niet gevonden" });
    delete pendingApprovals[token];
    io.emit("joinBeslissing", { token, beslissing: "afgewezen", name: aanvraag.name });
    return res.json({ success: true });
});

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

// ---------------- GAME STATE (voor reconnect) ----------------
app.get("/api/game-state", (req, res) => {
    res.json({
        fase: currentGame.fase,
        huidigeVraag: currentGame.huidigeVraag,
        quizData: currentGame.quizData,
        scores: currentGame.scores,
        players: currentGame.players,
        vraagStartTijd: currentGame.vraagStartTijd,
        resultaten: currentGame.fase === "resultaten" ? berekenResultaten() : null,
        podium: (currentGame.fase === "podium" || currentGame.fase === "eindpodium") ? berekenPodium() : null
    });
});

// ---------------- RESET GAME ----------------
app.post("/reset-game", (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ error: "Niet ingelogd" });
    quizStarted = false;
    Object.assign(currentGame, {
        players: [], scores: {}, id: null, quizId: null,
        quizData: null, huidigeVraag: -1, fase: "lobby",
        antwoorden: {}, vraagStartTijd: null
    });
    nextJoinId = 1001;
    pendingPlayers = [];
    io.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    io.emit("faseUpdate", { fase: "lobby" });
    return res.json({ success: true });
});

// ---------------- SOCKET.IO ----------------
io.on("connection", (socket) => {
    console.log("Nieuwe gebruiker verbonden");
    socket.emit("gameUpdate", { type: "playersUpdate", data: currentGame });
    socket.emit("phaseUpdate", "lobby");

    // Stuur huidige staat bij reconnect
    if (currentGame.fase && currentGame.fase !== "lobby") {
        const payload = buildFasePayload(currentGame.fase);
        socket.emit("faseUpdate", payload);
    }

    // ---- QUIZ NAVIGATIE (host) ----
    socket.on("volgendeVraag", () => {
        if (!currentGame.quizData) return;
        const totaal = currentGame.quizData.vragen.length;

        if (currentGame.fase === "lobby" || currentGame.fase === "podium") {
            // Ga naar volgende vraag
            if (currentGame.huidigeVraag < totaal - 1) {
                currentGame.huidigeVraag++;
                currentGame.fase = "vraag";
                currentGame.antwoorden = {};
                currentGame.vraagStartTijd = Date.now();
                io.emit("faseUpdate", buildFasePayload("vraag"));
            }
        } else if (currentGame.fase === "vraag") {
            // Ga naar resultaten
            // Verwerk scores voor wie correct heeft geantwoord
            verwerkScores();
            currentGame.fase = "resultaten";
            io.emit("faseUpdate", buildFasePayload("resultaten"));
        } else if (currentGame.fase === "resultaten") {
            // Ga naar podium
            const isLaatste = currentGame.huidigeVraag >= totaal - 1;
            currentGame.fase = isLaatste ? "eindpodium" : "podium";
            io.emit("faseUpdate", buildFasePayload(currentGame.fase));
        }
    });

    socket.on("vorigeVraag", () => {
        if (!currentGame.quizData) return;
        if (currentGame.fase === "vraag" && currentGame.huidigeVraag > 0) {
            currentGame.huidigeVraag--;
            currentGame.fase = "vraag";
            currentGame.antwoorden = {};
            currentGame.vraagStartTijd = Date.now();
            io.emit("faseUpdate", buildFasePayload("vraag"));
        }
    });

    socket.on("springNaarVraag", ({ index }) => {
        if (!currentGame.quizData) return;
        const totaal = currentGame.quizData.vragen.length;
        if (index >= 0 && index < totaal) {
            currentGame.huidigeVraag = index;
            currentGame.fase = "vraag";
            currentGame.antwoorden = {};
            currentGame.vraagStartTijd = Date.now();
            io.emit("faseUpdate", buildFasePayload("vraag"));
        }
    });

    // ---- ANTWOORD VAN SPELER ----
    socket.on("antwoord", ({ name, antwoordIndex }) => {
        if (currentGame.fase !== "vraag") return;
        if (!allowedNames.includes(name)) return;
        if (currentGame.antwoorden[name]) return; // al geantwoord

        const nu = Date.now();
        const seconden = currentGame.vraagStartTijd
            ? (nu - currentGame.vraagStartTijd) / 1000
            : 0;

        currentGame.antwoorden[name] = { antwoordIndex, seconden, tijdstip: nu };

        // Bevestig aan de speler zelf
        socket.emit("antwoordBevestigd", { name, antwoordIndex });

        // Stuur update hoeveel spelers al geantwoord hebben
        io.emit("antwoordUpdate", {
            aantalGeantwoord: Object.keys(currentGame.antwoorden).length,
            totaalSpelers: currentGame.players.length
        });

        // Als iedereen heeft geantwoord, automatisch naar resultaten
        if (Object.keys(currentGame.antwoorden).length >= currentGame.players.length) {
            verwerkScores();
            currentGame.fase = "resultaten";
            io.emit("faseUpdate", buildFasePayload("resultaten"));
        }
    });

    socket.on("helpRequest", data => {
        io.emit("gameUpdate", { type: "helpRequest", name: data.name || "Niet bekend" });
    });
});

function verwerkScores() {
    if (!currentGame.quizData) return;
    const vraag = currentGame.quizData.vragen[currentGame.huidigeVraag];
    if (!vraag) return;

    Object.entries(currentGame.antwoorden).forEach(([name, data]) => {
        const antwoord = vraag.antwoorden[data.antwoordIndex];
        if (antwoord && antwoord.correct) {
            const punten = berekenPunten(vraag, data.seconden);
            currentGame.scores[name] = (currentGame.scores[name] || 0) + punten;
        }
    });
}

function buildFasePayload(fase) {
    const base = {
        fase,
        huidigeVraag: currentGame.huidigeVraag,
        totaalVragen: currentGame.quizData ? currentGame.quizData.vragen.length : 0
    };

    if (fase === "vraag" && currentGame.quizData) {
        const v = currentGame.quizData.vragen[currentGame.huidigeVraag];
        return {
            ...base,
            vraag: v.vraag,
            antwoorden: v.antwoorden.map(a => ({ tekst: a.tekst })), // geen correct meesturen
            tijdlimiet: v.tijdlimiet || 20,
            punten: v.punten || 1000,
            vraagStartTijd: currentGame.vraagStartTijd
        };
    }

    if (fase === "resultaten") {
        return { ...base, resultaten: berekenResultaten(), scores: currentGame.scores };
    }

    if (fase === "podium" || fase === "eindpodium") {
        return { ...base, podium: berekenPodium(), scores: currentGame.scores };
    }

    return base;
}

// ---------------- SERVER ----------------
server.listen(PORT, "0.0.0.0", () => {
    console.log("Server draait op poort " + PORT);
});
