const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// Static public folder
app.use(express.static("public"));

/* ======================
   GAME DATA
====================== */

let gameCode = Math.floor(100000 + Math.random() * 900000).toString();
let players = [];

/* ======================
   ROUTES
====================== */

app.get("/", (req, res) => {
    res.redirect("/host");
});

app.get("/host", (req, res) => {
    res.sendFile(__dirname + "/public/host.html");
});

app.get("/player", (req, res) => {
    res.sendFile(__dirname + "/public/player.html");
});

app.get("/leaderboard", (req, res) => {
    res.sendFile(__dirname + "/public/leaderboard.html");
});

app.get("/gamecode", (req, res) => {
    res.json({ code: gameCode });
});

/* ======================
   SOCKET.IO
====================== */

io.on("connection", (socket) => {

    socket.on("joinGame", ({ name, code }) => {

        // verkeerde code
        if (code !== gameCode) {
            socket.emit("invalidCode");
            return;
        }

        // naam al in gebruik
        if (players.find(p => p.name === name)) {
            socket.emit("nameTaken");
            return;
        }

        const player = {
            id: uuidv4(),
            name: name,
            score: 0
        };

        players.push(player);

        io.emit("updatePlayers", players);
    });

    socket.on("disconnect", () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit("updatePlayers", players);
    });

});

/* ======================
   START SERVER
====================== */

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
