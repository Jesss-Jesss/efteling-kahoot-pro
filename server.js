const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const { v4: uuidv4 } = require("uuid");

// ====== MIDDLEWARE ======
app.use(express.static("public"));
app.use(express.json());

// ====== GAME DATA ======
let game = {
    code: Math.floor(100000 + Math.random() * 900000),
    players: []
};

let errors = [];

// ====== ERROR LOGGER ======
function logError(type, details) {
    errors.push({
        id: uuidv4(),
        type,
        details,
        time: new Date(),
        handled: false
    });
}

// ====== SOCKET.IO ======
io.on("connection", (socket) => {

    socket.on("joinGame", (data) => {

        // Ongeldige code
        if (parseInt(data.code) !== game.code) {
            logError("Invalid Game Code", {
                attemptedCode: data.code,
                name: data.name
            });

            socket.emit("invalidCode");
            return;
        }

        // Dubbele naam
        if (game.players.find(p => p.name === data.name)) {
            logError("Duplicate Name", {
                name: data.name
            });

            socket.emit("nameTaken");
            return;
        }

        const player = {
            id: socket.id,
            name: data.name
        };

        game.players.push(player);
        socket.join("gameRoom");

        io.to("gameRoom").emit("updatePlayers", game.players);
    });

    socket.on("disconnect", () => {
        game.players = game.players.filter(p => p.id !== socket.id);
        io.to("gameRoom").emit("updatePlayers", game.players);
    });

});

// ====== ROUTES ======

app.get("/", (req, res) => {
    res.redirect("/host");
});

app.get("/host", (req, res) => {
    res.sendFile(__dirname + "/public/host.html");
});

app.get("/player", (req, res) => {
    res.sendFile(__dirname + "/public/player.html");
});

// Game code ophalen
app.get("/gamecode", (req, res) => {
    res.json({ code: game.code });
});

// Errors ophalen
app.get("/errors", (req, res) => {
    res.json(errors);
});

// Nieuwe game starten
app.post("/newgame", (req, res) => {
    game.code = Math.floor(100000 + Math.random() * 900000);
    game.players = [];
    errors = [];

    res.json({ code: game.code });
});

// ====== SERVER START ======
const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
